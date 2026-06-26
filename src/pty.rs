#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use crate::event_bus::BusEvent;
use crate::session::{Session, SessionManager, SessionStatus, SyncMsg};
use crate::vt_screen::VirtualScreen;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

/// Create a new PTY session and register it with the session manager.
///
/// # Errors
/// Returns `Err` if the PTY cannot be opened, the shell cannot be spawned,
/// or the reader/writer cannot be obtained.
///
/// # Panics
/// Panics if the internal mutex is poisoned in the PTY reader task.
pub fn create_session(
    manager: &Arc<SessionManager>,
    pane_id: &str,
    tauri_on_exit: Option<Arc<dyn Fn(String) + Send + Sync>>,
    cwd: Option<PathBuf>,
) -> Result<(Arc<Session>, String), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell = get_shell();
    let shell_type = get_shell_type(&shell);
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(get_shell_args(&shell));
    cmd.env("TERM", "xterm-256color");

    let home_path = std::env::var("HOME").map_or_else(
        |_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
        PathBuf::from,
    );

    let effective_cwd = cwd.filter(|p| p.is_dir()).unwrap_or_else(|| home_path.clone());
    cmd.cwd(&effective_cwd);

    // Shell-specific env setup still uses $HOME (for ZDOTDIR/PROMPT_COMMAND)
    if let Ok(ref home) = std::env::var("HOME") {
        match shell_type.as_str() {
            "zsh" => {
                if let Some(zdotdir) = setup_zsh_title_hooks(home) {
                    cmd.env("ZDOTDIR", &zdotdir);
                }
            }
            "bash" => {
                cmd.env(
                    "PROMPT_COMMAND",
                    r#"history -a; history -r; printf "\033]0;%s@%s:%s\007" "${USER}" "${HOSTNAME%%.*}" "${PWD/#$HOME/~}"; printf "\033]133;A\033\\"; printf "\033]133;D;%d\033\\" $?""#,
                );
                // Inject preexec-like trap for command start detection
                cmd.env("BASH_ENV", r#"trap 'printf "\033]133;B\033\\"' DEBUG"#);
            }
            _ => {}
        }
    }

    let home_for_cwd = effective_cwd;

    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn shell: {e}"))?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Box<dyn Write + Send> = pair.master.take_writer().map_err(|e| e.to_string())?;

    let initial_cwd = home_for_cwd.canonicalize().unwrap_or_else(|_| home_for_cwd.clone());

    let session = Arc::new(Session {
        writer: std::sync::Mutex::new(writer),
        master: std::sync::Mutex::new(pair.master),
        child: std::sync::Mutex::new(child),
        screen: std::sync::Mutex::new(VirtualScreen::new(80, 24)),
        clients: std::sync::Mutex::new(Vec::new()),
        input_tx: std::sync::Mutex::new(None),
        status: std::sync::Mutex::new(SessionStatus::Connected),
        size: std::sync::Mutex::new((80, 24)),
        shell_type: shell_type.clone(),
        tauri_on_exit: std::sync::Mutex::new(tauri_on_exit),
        cwd_state: std::sync::Mutex::new(crate::session::CwdState {
            cwd: initial_cwd,
            sniff_buf: Vec::new(),
        }),
    });
    manager.sessions.insert(pane_id.to_string(), Arc::clone(&session));

    // Publish session created event
    manager.event_bus.publish(BusEvent::SessionCreated {
        pane_id: pane_id.to_string(),
        shell_type: shell_type.clone(),
    });

    let session_clone = Arc::clone(&session);
    let pane_id_clone = pane_id.to_string();
    let manager_clone = Arc::clone(manager);
    tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut utf8_tail: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    // Feed to virtual screen and check for command completion
                    let command_results = {
                        let mut screen = session_clone.screen.lock().expect("mutex poisoned");
                        screen.feed(data);
                        let results = screen.drain_command_results();
                        // Collect stdout for each result while still holding the lock
                        let outputs: Vec<String> =
                            (0..results.len()).map(|_| screen.take_command_output()).collect();
                        results.into_iter().zip(outputs).collect::<Vec<_>>()
                    };
                    // Publish command_finished events
                    for (result, stdout) in command_results {
                        manager_clone.event_bus.publish(BusEvent::CommandFinished {
                            pane_id: pane_id_clone.clone(),
                            command: String::new(), // Will be filled by agent API
                            exit_code: result.exit_code,
                            duration_ms: result.duration_ms,
                            stdout,
                            method: result.method.clone(),
                        });
                        manager_clone.broadcast_sync(&SyncMsg::CommandFinished {
                            pane_id: pane_id_clone.clone(),
                            command: String::new(),
                            exit_code: result.exit_code,
                            duration_ms: result.duration_ms,
                            stdout: String::new(),
                            method: result.method,
                        });
                    }
                    session_clone.on_pty_output(data);

                    utf8_tail.extend_from_slice(data);
                    let valid_up_to = match std::str::from_utf8(&utf8_tail) {
                        Ok(s) => {
                            session_clone.broadcast(s);
                            utf8_tail.clear();
                            continue;
                        }
                        Err(e) => e.valid_up_to(),
                    };
                    if valid_up_to > 0 {
                        let s = unsafe { std::str::from_utf8_unchecked(&utf8_tail[..valid_up_to]) };
                        session_clone.broadcast(s);
                    }
                    utf8_tail.drain(..valid_up_to);
                    // Keep only the trailing incomplete bytes (max 3 for UTF-8)
                    if utf8_tail.len() > 3 {
                        // Invalid sequence — flush as replacement and reset
                        session_clone.broadcast("\u{FFFD}");
                        utf8_tail.clear();
                    }
                }
            }
        }
        if manager_clone.sessions.remove(&pane_id_clone).is_some() {
            // Publish session closed event
            manager_clone.event_bus.publish(BusEvent::SessionClosed {
                pane_id: pane_id_clone.clone(),
                exit_code: None,
            });
            // Find the parent tab and clean up its layout; for single-pane tabs
            // this returns the tab-level pane_id so we broadcast the correct ID.
            let tab_pane_id = manager_clone
                .on_pty_exited(&pane_id_clone)
                .unwrap_or_else(|| pane_id_clone.clone());
            manager_clone.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_pane_id });
        }
        info!("PTY exited, session removed: pane={}", pane_id_clone);
        let cb = session_clone.tauri_on_exit.lock().expect("mutex poisoned").clone();
        if let Some(f) = cb {
            f(pane_id_clone);
        }
    });

    Ok((session, shell_type))
}

#[must_use]
pub fn setup_zsh_title_hooks(home: &str) -> Option<std::path::PathBuf> {
    let zdotdir = std::env::temp_dir().join(format!("dinotty_zsh_{}", std::process::id()));
    std::fs::create_dir_all(&zdotdir).ok()?;

    let zshenv = format!(
        r#"[[ -f "{home}/.zshenv" ]] && source "{home}/.zshenv"
"#
    );

    let zshrc = format!(
        r#"# dinotty title injection — loaded via ZDOTDIR
ZDOTDIR=  # reset so child shells behave normally

[[ -f "{home}/.zshrc" ]] && source "{home}/.zshrc"

# Ensure history is saved — fallback if user config doesn't set these
[[ $HISTSIZE -gt 0 ]] || HISTSIZE=10000
[[ $SAVEHIST -gt 0 ]] || SAVEHIST=10000
[[ -n "$HISTFILE" ]] || HISTFILE="$HOME/.zsh_history"
setopt INC_APPEND_HISTORY SHARE_HISTORY

function _dinotty_precmd {{
  printf "\033]0;%s@%s:%s\007" "${{USER}}" "${{HOST%%.*}}" "${{PWD/#$HOME/~}}"
  printf "\033]133;A\033\\"
  printf "\033]133;D;%d\033\\" $?
}}

function _dinotty_preexec {{
  printf "\033]0;%s\007" "$1"
  printf "\033]133;B\033\\"
}}

if [[ -z "${{precmd_functions[(r)_dinotty_precmd]}}" ]]; then
  precmd_functions+=(_dinotty_precmd)
fi
if [[ -z "${{preexec_functions[(r)_dinotty_preexec]}}" ]]; then
  preexec_functions+=(_dinotty_preexec)
fi
"#
    );

    let zprofile = format!(
        r#"[[ -f "{home}/.zprofile" ]] && source "{home}/.zprofile"
"#
    );

    std::fs::write(zdotdir.join(".zshenv"), zshenv).ok()?;
    std::fs::write(zdotdir.join(".zshrc"), zshrc).ok()?;
    std::fs::write(zdotdir.join(".zprofile"), zprofile).ok()?;
    Some(zdotdir)
}

#[must_use]
pub fn get_shell() -> String {
    // Non-interactive shells that should be skipped
    const BLOCKED: &[&str] = &[
        "/sbin/nologin",
        "/usr/sbin/nologin",
        "/bin/false",
        "/usr/bin/false",
        "/bin/nologin",
        "/usr/bin/nologin",
    ];

    if let Ok(s) = std::env::var("SHELL") {
        if std::path::Path::new(&s).exists() && !BLOCKED.contains(&s.as_str()) {
            return s;
        }
    }
    for s in ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"] {
        if std::path::Path::new(s).exists() {
            return s.to_string();
        }
    }
    "/bin/sh".to_string()
}

#[must_use]
pub fn get_shell_type(shell: &str) -> String {
    if shell.contains("zsh") {
        "zsh".into()
    } else if shell.contains("bash") {
        "bash".into()
    } else {
        "sh".into()
    }
}

#[must_use]
pub fn get_shell_args(shell: &str) -> Vec<&'static str> {
    if shell.contains("zsh") || shell.contains("bash") {
        vec!["-i", "-l"]
    } else {
        vec!["-i"]
    }
}
