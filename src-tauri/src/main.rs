use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use xterm_server::pty;
use xterm_server::session::{SessionManager, SessionStatus, SyncMsg};

mod embedded_server;

#[derive(Clone, Serialize)]
struct PtyOutput {
    pane_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    pane_id: String,
}

fn spawn_tauri_output_forwarder(app: AppHandle, pane_id: String, session: Arc<xterm_server::session::Session>) {
    let mut rx = session.add_client();
    let app2 = app.clone();
    let pid = pane_id.clone();
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let _ = app2.emit(
                "pty-output",
                PtyOutput {
                    pane_id: pid.clone(),
                    data,
                },
            );
        }
    });
}

fn emit_join_sync(app: &AppHandle, pane_id: &str, session: &Arc<xterm_server::session::Session>) {
    let (cols, rows) = *session.size.lock().unwrap();
    let _ = app.emit(
        "pty-reconnected",
        serde_json::json!({ "pane_id": pane_id, "cols": cols, "rows": rows }),
    );
    let (scrollback_chunks, snapshot) = {
        let screen = session.screen.lock().unwrap();
        (screen.snapshot_scrollback_chunks(200), screen.snapshot())
    };
    for chunk in scrollback_chunks {
        let _ = app.emit(
            "pty-output",
            PtyOutput {
                pane_id: pane_id.to_string(),
                data: chunk,
            },
        );
    }
    let _ = app.emit(
        "pty-output",
        PtyOutput {
            pane_id: pane_id.to_string(),
            data: snapshot,
        },
    );
}

#[tauri::command]
fn pty_spawn(
    pane_id: String,
    app: AppHandle,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    let manager = state.inner().clone();
    let app_cb = app.clone();
    let exit_cb: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |pid: String| {
        let _ = app_cb.emit("pty-exit", PtyExit { pane_id: pid });
    });

    if let Some(entry) = manager.sessions.get(&pane_id) {
        let session = Arc::clone(entry.value());
        *session.status.lock().unwrap() = SessionStatus::Connected;
        {
            let mut g = session.tauri_on_exit.lock().unwrap();
            if g.is_none() {
                *g = Some(Arc::clone(&exit_cb));
            }
        }
        emit_join_sync(&app, &pane_id, &session);
        spawn_tauri_output_forwarder(app.clone(), pane_id.clone(), Arc::clone(&session));
        return Ok(session.shell_type.clone());
    }

    let (session, shell_type) =
        pty::create_session(Arc::clone(&manager), pane_id.clone(), Some(Arc::clone(&exit_cb)))?;

    spawn_tauri_output_forwarder(app.clone(), pane_id.clone(), Arc::clone(&session));

    Ok(shell_type)
}

#[tauri::command]
fn pty_write(
    pane_id: String,
    data: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    use std::io::Write;
    let sessions = &state.sessions;
    let session = sessions.get(&pane_id).ok_or("session not found")?;
    let mut w = session.writer.lock().unwrap();
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_resize(
    pane_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    use portable_pty::PtySize;
    let sessions = &state.sessions;
    let session = sessions.get(&pane_id).ok_or("session not found")?;
    let m = session.master.lock().unwrap();
    m.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|e| e.to_string())?;
    drop(m);
    *session.size.lock().unwrap() = (cols, rows);
    session
        .screen
        .lock()
        .unwrap()
        .resize(cols as usize, rows as usize);
    Ok(())
}

#[tauri::command]
fn pty_kill(pane_id: String, state: State<'_, Arc<SessionManager>>) -> Result<(), String> {
    state.sessions.remove(&pane_id);
    state.broadcast_sync(&SyncMsg::TabClosed {
        pane_id: pane_id.clone(),
    });
    Ok(())
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::new(
                std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
            ),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let port = parse_port(&args);

    let manager = Arc::new(SessionManager::new());
    manager.start_cleanup_task();

    if args.contains(&"--server".to_string()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(embedded_server::run_server(port, Arc::clone(&manager)));
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(manager.clone())
        .setup(move |_app| {
            let mgr = Arc::clone(&manager);
            tokio::spawn(embedded_server::run_server(port, mgr));
            tracing::info!("Desktop mode: embedded server on port {}", port);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}

fn parse_port(args: &[String]) -> u16 {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if let Some(v) = args.get(i + 1) {
                    return v.parse().unwrap_or(8999);
                }
            }
            s if s.starts_with("--port=") => {
                return s[7..].parse().unwrap_or(8999);
            }
            _ => {}
        }
        i += 1;
    }
    8999
}
