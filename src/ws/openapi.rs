use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use tracing::{error, info, warn};

use crate::session::{SessionClientEvent, SessionManager};
use crate::settings::SettingsState;

use super::types::{ClientMsg, InputRequest, ServerMsg};

/// # Panics
/// Panics if the internal mutex is poisoned.
pub async fn post_input(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<InputRequest>,
) -> impl IntoResponse {
    let s = settings.read().await;
    if !s.open_api.enabled {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "open_api is disabled" })),
        );
    }
    drop(s);

    let pane_id = req.pane_id.clone().or_else(|| {
        manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    });

    let pane_id = match pane_id {
        Some(id) if manager.sessions.contains_key(&id) => id,
        _ => {
            // Fall back to first available session
            match manager.sessions.iter().next() {
                Some(entry) => entry.key().clone(),
                None => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({ "error": "no active pane" })),
                    )
                }
            }
        }
    };

    match manager.sessions.get(&pane_id) {
        Some(session) => {
            let _ = session.write_input_async(req.data.as_bytes()).await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
        }
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" }))),
    }
}

/// # Panics
/// Panics if the internal mutex is poisoned.
pub async fn handle_open_api_ws(socket: WebSocket, manager: Arc<SessionManager>, pane_id: String) {
    let session = match manager.sessions.get(&pane_id) {
        Some(s) => Arc::clone(s.value()),
        None => return,
    };

    let (ws_tx, mut ws_rx) = socket.split();
    let (ws_out_tx, mut ws_out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Writer task
    let writer_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = ws_out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Ping task
    let ping_tx = ws_out_tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await;
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
        }
    });

    // Register as broadcast client
    let (client_id, mut rx) = session.add_client();

    // Forward broadcast output to WS
    let fwd_ws_out_tx = ws_out_tx.clone();
    let fwd_pane = pane_id.clone();
    let fwd = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let msg = match event {
                SessionClientEvent::Output(data) => {
                    serde_json::to_string(&ServerMsg::Output { data: &data })
                }
                SessionClientEvent::Resize { cols, rows } => {
                    serde_json::to_string(&ServerMsg::Resize { cols, rows })
                }
                SessionClientEvent::SessionExit { pane_id: _ } => {
                    serde_json::to_string(&ServerMsg::SessionExit)
                }
                SessionClientEvent::SyncBegin => serde_json::to_string(&ServerMsg::SyncBegin),
                SessionClientEvent::SyncEnd => serde_json::to_string(&ServerMsg::SyncEnd),
                SessionClientEvent::ReplayBegin { cols, rows } => {
                    serde_json::to_string(&ServerMsg::ReplayBegin { cols, rows })
                }
                SessionClientEvent::ReplayEnd => serde_json::to_string(&ServerMsg::ReplayEnd),
            }
            .expect("serialization is infallible");
            if fwd_ws_out_tx.send(Message::Text(msg)).is_err() {
                info!("WS forwarder (open_api): send failed, exiting pane={}", fwd_pane);
                break;
            }
        }
        info!("WS forwarder (open_api): channel closed, exiting pane={}", fwd_pane);
    });

    // PTY write task: avoids blocking the WS read loop with synchronous I/O
    let (pty_in_tx, mut pty_in_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let write_session = Arc::clone(&session);
    let write_pane = pane_id.clone();
    let is_ssh = write_session.is_ssh();
    tokio::spawn(async move {
        while let Some(first) = pty_in_rx.recv().await {
            if write_session.is_exited() {
                break;
            }
            let mut batch = first;
            while let Ok(data) = pty_in_rx.try_recv() {
                batch.push_str(&data);
            }
            let batch_len = batch.len();
            let result = if is_ssh {
                write_session.write_input_async(batch.as_bytes()).await
            } else {
                let ws = Arc::clone(&write_session);
                tokio::task::spawn_blocking(move || ws.write_input_blocking(batch.as_bytes()))
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()))
            };
            match result {
                Ok(()) => {}
                Err(e) => {
                    error!("PTY write error ({}B): {}, pane={}", batch_len, e, write_pane);
                    break;
                }
            }
        }
        info!("PTY write task (open_api) exited, pane={}", write_pane);
    });

    // Read loop: accept Input and Resize messages
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text) {
                    match client_msg {
                        ClientMsg::Input { data } => {
                            let _ = pty_in_tx.send(data);
                        }
                        ClientMsg::Resize { cols, rows } => {
                            session.resize_debounced(client_id, cols, rows);
                        }
                        ClientMsg::SnapshotRequest { cols, rows } => {
                            if let Err(e) = session
                                .atomic_resize_and_snapshot_for_client(client_id, cols, rows)
                                .await
                            {
                                warn!("snapshot_request failed: {e}, pane={}", pane_id);
                            }
                        }
                    }
                }
            }
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    fwd.abort();
    writer_task.abort();
    ping_task.abort();
    session.remove_client(client_id);
}
