use crate::session::{Session, SessionManager, SessionStatus, SyncMsg};
use crate::vt_screen::VirtualScreen;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

pub fn create_session(
    manager: Arc<SessionManager>,
    pane_id: String,
    tauri_on_exit: Option<Arc<dyn Fn(String) + Send + Sync>>,
) -> Result<(Arc<Session>, String), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = get_shell();
    let shell_type = get_shell_type(&shell);
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(get_shell_args(&shell));
    cmd.env("TERM", "xterm-256color");

    let home_for_cwd = if let Ok(ref home) = std::env::var("HOME") {
        cmd.cwd(home);
        match shell_type.as_str() {
            "zsh" => {
                if let Some(zdotdir) = setup_zsh_title_hooks(home) {
                    cmd.env("ZDOTDIR", &zdotdir);
                }
            }
            "bash" => {
                cmd.env(
                    "PROMPT_COMMAND",
                    r#"printf "\033]0;%s@%s:%s\007" "${USER}" "${HOSTNAME%%.*}" "${PWD/#$HOME/~}""#,
                );
            }
            _ => {}
        }
        PathBuf::from(home)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"))
    };

    pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell: {}", e))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer: Box<dyn Write + Send> = pair.master.take_writer().map_err(|e| e.to_string())?;

    let initial_cwd = home_for_cwd
        .canonicalize()
        .unwrap_or_else(|_| home_for_cwd.clone());

    let session = Arc::new(Session {
        writer: std::sync::Mutex::new(writer),
        master: std::sync::Mutex::new(pair.master),
        screen: std::sync::Mutex::new(VirtualScreen::new(80, 24)),
        clients: std::sync::Mutex::new(Vec::new()),
        status: std::sync::Mutex::new(SessionStatus::Connected),
        size: std::sync::Mutex::new((80, 24)),
        shell_type: shell_type.clone(),
        tauri_on_exit: std::sync::Mutex::new(tauri_on_exit),
        cwd_state: std::sync::Mutex::new(crate::session::CwdState {
            cwd: initial_cwd,
            sniff_buf: Vec::new(),
        }),
    });
    manager.sessions.insert(pane_id.clone(), Arc::clone(&session));
    manager.broadcast_sync(&SyncMsg::TabCreated {
        pane_id: pane_id.clone(),
    });

    let session_clone = Arc::clone(&session);
    let pane_id_clone = pane_id.clone();
    let manager_clone = Arc::clone(&manager);
    tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    session_clone.screen.lock().unwrap().feed(data);
                    let s = String::from_utf8_lossy(data).to_string();
                    session_clone.broadcast(&s);
                    session_clone.on_pty_output(data);
                }
            }
        }
        if manager_clone.sessions.remove(&pane_id_clone).is_some() {
            manager_clone.broadcast_sync(&SyncMsg::TabClosed {
                pane_id: pane_id_clone.clone(),
            });
        }
        info!("PTY exited, session removed: pane={}", pane_id_clone);
        let cb = session_clone.tauri_on_exit.lock().unwrap().clone();
        if let Some(f) = cb {
            f(pane_id_clone);
        }
    });

    Ok((session, shell_type))
}

pub fn setup_zsh_title_hooks(home: &str) -> Option<std::path::PathBuf> {
    let zdotdir = std::env::temp_dir().join(format!("xterm_zsh_{}", std::process::id()));
    std::fs::create_dir_all(&zdotdir).ok()?;

    let zshrc = format!(
        r#"# xterm title injection — loaded via ZDOTDIR
ZDOTDIR=  # reset so child shells behave normally

[[ -f "{home}/.zshrc" ]] && source "{home}/.zshrc"

function _xterm_precmd {{
  printf "\033]0;%s@%s:%s\007" "${{USER}}" "${{HOST%%.*}}" "${{PWD/#$HOME/~}}"
}}

function _xterm_preexec {{
  printf "\033]0;%s\007" "$1"
}}

if [[ -z "${{precmd_functions[(r)_xterm_precmd]}}" ]]; then
  precmd_functions+=(_xterm_precmd)
fi
if [[ -z "${{preexec_functions[(r)_xterm_preexec]}}" ]]; then
  preexec_functions+=(_xterm_preexec)
fi
"#,
        home = home
    );

    let zprofile = format!(
        r#"[[ -f "{home}/.zprofile" ]] && source "{home}/.zprofile"
"#,
        home = home
    );

    std::fs::write(zdotdir.join(".zshrc"), zshrc).ok()?;
    std::fs::write(zdotdir.join(".zprofile"), zprofile).ok()?;
    Some(zdotdir)
}

pub fn get_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if std::path::Path::new(&s).exists() {
            return s;
        }
    }
    for s in [
        "/bin/zsh",
        "/usr/bin/zsh",
        "/bin/bash",
        "/usr/bin/bash",
        "/bin/sh",
    ] {
        if std::path::Path::new(s).exists() {
            return s.to_string();
        }
    }
    "/bin/sh".to_string()
}

pub fn get_shell_type(shell: &str) -> String {
    if shell.contains("zsh") {
        "zsh".into()
    } else if shell.contains("bash") {
        "bash".into()
    } else {
        "sh".into()
    }
}

pub fn get_shell_args(shell: &str) -> Vec<&'static str> {
    if shell.contains("zsh") || shell.contains("bash") {
        vec!["-i", "-l"]
    } else {
        vec!["-i"]
    }
}
