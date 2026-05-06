use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{NativePtySystem, PtySize, PtySystem, CommandBuilder};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tokio::sync::mpsc;
use tracing::{error, info};

use crate::terminal::TerminalManager;

#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(rename = "paneId")]
    pane_id: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg<'a> {
    Output { data: &'a str },
    ShellInfo { shell_type: &'a str },
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(manager): State<Arc<TerminalManager>>,
) -> impl IntoResponse {
    let pane_id = q.pane_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    ws.on_upgrade(move |socket| handle_socket(socket, pane_id, manager))
}

async fn handle_socket(socket: WebSocket, pane_id: String, manager: Arc<TerminalManager>) {
    info!("WebSocket connected: pane={}", pane_id);

    let pty_system = NativePtySystem::default();
    let pair = match pty_system.openpty(PtySize {
        rows: 24, cols: 80, pixel_width: 0, pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => { error!("Failed to open pty: {}", e); return; }
    };

    let shell = get_shell();
    let shell_type = get_shell_type(&shell);
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(get_shell_args(&shell));
    cmd.env("TERM", "xterm-256color");

    let mut zdotdir_cleanup: Option<std::path::PathBuf> = None;

    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(&home);

        match shell_type.as_str() {
            "zsh" => {
                if let Some(zdotdir) = setup_zsh_title_hooks(&home) {
                    cmd.env("ZDOTDIR", &zdotdir);
                    zdotdir_cleanup = Some(zdotdir);
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
    }

    if let Err(e) = pair.slave.spawn_command(cmd) {
        error!("Failed to spawn shell: {}", e);
        return;
    }
    drop(pair.slave);

    let reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => { error!("clone reader: {}", e); return; }
    };
    let writer: Box<dyn Write + Send> = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => { error!("take writer: {}", e); return; }
    };
    let writer = Arc::new(Mutex::new(writer));
    let master = Arc::new(Mutex::new(pair.master));

    manager.sessions.insert(pane_id.clone(), Arc::clone(&writer));

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let tx_clone = tx;
    tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_clone.send(s).is_err() { break; }
                }
            }
        }
    });

    let shell_info = serde_json::to_string(&ServerMsg::ShellInfo { shell_type: &shell_type }).unwrap();
    let _ = ws_tx.send(Message::Text(shell_info.into())).await;

    let fwd = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
            if ws_tx.send(Message::Text(msg.into())).await.is_err() { break; }
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(ClientMsg::Input { data }) => {
                        let mut w = writer.lock().unwrap();
                        let _ = w.write_all(data.as_bytes());
                    }
                    Ok(ClientMsg::Resize { cols, rows }) => {
                        let m = master.lock().unwrap();
                        let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                    }
                    Err(e) => error!("parse msg: {}", e),
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    fwd.abort();
    manager.sessions.remove(&pane_id);
    if let Some(dir) = zdotdir_cleanup {
        let _ = std::fs::remove_dir_all(dir);
    }
    info!("WebSocket closed: pane={}", pane_id);
}

fn setup_zsh_title_hooks(home: &str) -> Option<std::path::PathBuf> {
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

fn get_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if std::path::Path::new(&s).exists() { return s; }
    }
    for s in ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"] {
        if std::path::Path::new(s).exists() { return s.to_string(); }
    }
    "/bin/sh".to_string()
}

fn get_shell_type(shell: &str) -> String {
    if shell.contains("zsh") { "zsh".into() }
    else if shell.contains("bash") { "bash".into() }
    else { "sh".into() }
}

fn get_shell_args(shell: &str) -> Vec<&'static str> {
    if shell.contains("zsh") || shell.contains("bash") { vec!["-i", "-l"] }
    else { vec!["-i"] }
}
