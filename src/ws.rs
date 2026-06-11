use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use serde::{Deserialize, Serialize};
use std::{io::Write, sync::Arc};

use tracing::{error, info};

use crate::history::HistoryState;
use crate::session::{SessionManager, SessionStatus, SyncMsg};
use crate::notification::NotificationBroadcast;
use crate::settings::SettingsState;

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

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncClientMsg {
    ActivateTab { pane_id: String },
    CreateTab { pane_id: String },
    CloseTab { pane_id: String },
    ClosePane { pane_id: String },
    UpdateLayout { pane_id: String, layout: serde_json::Value, active_pane_id: String },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg<'a> {
    Output { data: &'a str },
    ShellInfo { shell_type: &'a str },
    Reconnected { cols: u16, rows: u16 },
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(manager): State<Arc<SessionManager>>,
    State(history): State<HistoryState>,
) -> impl IntoResponse {
    let pane_id = q.pane_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    ws.on_upgrade(move |socket| handle_socket(socket, pane_id, manager, history))
}

pub async fn sync_handler(
    ws: WebSocketUpgrade,
    State(manager): State<Arc<SessionManager>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_sync_socket(socket, manager))
}

async fn handle_sync_socket(socket: WebSocket, manager: Arc<SessionManager>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Send current tab list with active tab
    let (tabs, active_pane_id) = manager.tab_list();
    let tab_list = SyncMsg::TabList { tabs, active_pane_id };
    let msg = serde_json::to_string(&tab_list).unwrap();
    if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }

    // Register this client for sync broadcasts
    let mut rx = manager.add_sync_client();

    let fwd = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if ws_tx.send(Message::Text(data.into())).await.is_err() { break; }
        }
    });

    // Process incoming sync messages from this client
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(sync_msg) = serde_json::from_str::<SyncClientMsg>(&text) {
                    match sync_msg {
                        SyncClientMsg::ActivateTab { pane_id } => {
                            *manager.active_pane_id.lock().unwrap() = Some(pane_id.clone());
                            manager.broadcast_sync(&SyncMsg::TabActivated { pane_id });
                        }
                        SyncClientMsg::CreateTab { pane_id } => {
                            *manager.active_pane_id.lock().unwrap() = Some(pane_id.clone());
                            manager.broadcast_sync(&SyncMsg::TabCreated { pane_id });
                        }
                        SyncClientMsg::CloseTab { pane_id } => {
                            manager.sessions.remove(&pane_id);
                            manager.tab_layouts.remove(&pane_id);
                            // Remove stale pane_id from any parent tab layouts
                            manager.purge_pane_from_layouts(&pane_id);
                            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id });
                        }
                        SyncClientMsg::ClosePane { pane_id } => {
                            // Close a single pane in a split — only remove its session,
                            // don't touch tab layout or broadcast tab_closed
                            manager.sessions.remove(&pane_id);
                            manager.purge_pane_from_layouts(&pane_id);
                        }
                        SyncClientMsg::UpdateLayout { pane_id, layout, active_pane_id } => {
                            manager.tab_layouts.insert(pane_id.clone(), serde_json::json!({
                                "layout": layout,
                                "active_pane_id": active_pane_id,
                            }));
                            manager.broadcast_sync(&SyncMsg::LayoutUpdated {
                                pane_id,
                                layout,
                                active_pane_id,
                            });
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    fwd.abort();
}

async fn handle_socket(socket: WebSocket, pane_id: String, manager: Arc<SessionManager>, history: HistoryState) {
    info!("WebSocket connected: pane={}", pane_id);
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut input_buffer = String::new();

    // Check if session already exists (reconnection / multi-client case)
    let existing_session = manager.sessions.get(&pane_id).map(|r| Arc::clone(r.value()));
    if let Some(session) = existing_session {
        info!("Joining existing session: pane={}", pane_id);

        *session.status.lock().unwrap() = SessionStatus::Connected;

        // Snapshot screen state and register for broadcast atomically
        // (holding the screen lock prevents PTY output from being both in the
        // snapshot AND queued to the broadcast channel)
        let (cols, rows, scrollback_chunks, snapshot, mut rx) = {
            let screen = session.screen.lock().unwrap();
            let (cols, rows) = *session.size.lock().unwrap();
            let chunks = screen.snapshot_scrollback_chunks(200);
            let snap = screen.snapshot();
            let rx = session.add_client();
            (cols, rows, chunks, snap, rx)
        };

        // Send reconnected message
        let msg = serde_json::to_string(&ServerMsg::Reconnected { cols, rows }).unwrap();
        if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }
        for chunk in &scrollback_chunks {
            let msg = serde_json::to_string(&ServerMsg::Output { data: chunk }).unwrap();
            if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }
        }

        let msg = serde_json::to_string(&ServerMsg::Output { data: &snapshot }).unwrap();
        if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }

        let fwd = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
                if ws_tx.send(Message::Text(msg.into())).await.is_err() { break; }
            }
        });

        // Input channel: replaces old channel so only this connection writes to PTY
        let mut input_rx = session.replace_input_channel();
        let write_session = Arc::clone(&session);
        tokio::spawn(async move {
            while let Some(data) = input_rx.recv().await {
                let mut w = write_session.writer.lock().unwrap();
                let _ = w.write_all(data.as_bytes());
            }
        });

        // Read loop
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(ClientMsg::Input { data }) => {
                            for ch in data.chars() {
                                if ch == '\r' || ch == '\n' {
                                    let cmd = input_buffer.trim().to_string();
                                    if !cmd.is_empty() {
                                        let h = history.clone();
                                        tokio::spawn(async move { h.push_realtime(&cmd).await; });
                                    }
                                    input_buffer.clear();
                                } else if ch == '\x7f' || ch == '\x08' {
                                    input_buffer.pop();
                                } else if ch == '\x03' || ch == '\x15' {
                                    input_buffer.clear();
                                } else if !ch.is_control() {
                                    input_buffer.push(ch);
                                }
                            }
                            let tx = session.input_tx.lock().unwrap();
                            if let Some(tx) = tx.as_ref() {
                                let _ = tx.send(data);
                            }
                        }
                        Ok(ClientMsg::Resize { cols, rows }) => {
                            let m = session.master.lock().unwrap();
                            let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                            drop(m);
                            *session.size.lock().unwrap() = (cols, rows);
                            session.screen.lock().unwrap().resize(cols as usize, rows as usize);
                        }
                        Err(e) => error!("parse msg: {}", e),
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        fwd.abort();

        if !session.has_clients() {
            *session.status.lock().unwrap() = SessionStatus::Detached { since: std::time::Instant::now() };
            info!("Session detached (all clients gone): pane={}", pane_id);
        }
        return;
    }

    // ── New session ──
    let (session, shell_type) = match crate::pty::create_session(Arc::clone(&manager), pane_id.clone(), None) {
        Ok(x) => x,
        Err(e) => {
            error!("{}", e);
            return;
        }
    };

    let mut rx = session.add_client();

    // Send shell info
    let shell_info = serde_json::to_string(&ServerMsg::ShellInfo { shell_type: &shell_type }).unwrap();
    let _ = ws_tx.send(Message::Text(shell_info.into())).await;

    // Forward PTY output to this WS client
    let fwd = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
            if ws_tx.send(Message::Text(msg.into())).await.is_err() { break; }
        }
    });

    // Input channel: dedicated write task reads from channel → PTY writer
    let mut input_rx = session.replace_input_channel();
    let write_session = Arc::clone(&session);
    tokio::spawn(async move {
        while let Some(data) = input_rx.recv().await {
            let mut w = write_session.writer.lock().unwrap();
            let _ = w.write_all(data.as_bytes());
        }
    });

    // WS read loop
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(ClientMsg::Input { data }) => {
                        for ch in data.chars() {
                            if ch == '\r' || ch == '\n' {
                                let cmd = input_buffer.trim().to_string();
                                if !cmd.is_empty() {
                                    let h = history.clone();
                                    tokio::spawn(async move { h.push_realtime(&cmd).await; });
                                }
                                input_buffer.clear();
                            } else if ch == '\x7f' || ch == '\x08' {
                                input_buffer.pop();
                            } else if ch == '\x03' || ch == '\x15' {
                                input_buffer.clear();
                            } else if !ch.is_control() {
                                input_buffer.push(ch);
                            }
                        }
                        let tx = session.input_tx.lock().unwrap();
                        if let Some(tx) = tx.as_ref() {
                            let _ = tx.send(data);
                        }
                    }
                    Ok(ClientMsg::Resize { cols, rows }) => {
                        let m = session.master.lock().unwrap();
                        let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                        drop(m);
                        *session.size.lock().unwrap() = (cols, rows);
                        session.screen.lock().unwrap().resize(cols as usize, rows as usize);
                    }
                    Err(e) => error!("parse msg: {}", e),
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    fwd.abort();

    if !session.has_clients() {
        *session.status.lock().unwrap() = SessionStatus::Detached { since: std::time::Instant::now() };
        info!("Session detached (all clients gone): pane={}", pane_id);
    }
}

pub async fn notification_ws_handler(
    ws: WebSocketUpgrade,
    State(notifier): State<Arc<NotificationBroadcast>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_notification_socket(socket, notifier))
}

async fn handle_notification_socket(socket: WebSocket, notifier: Arc<NotificationBroadcast>) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut rx = notifier.subscribe();

    let fwd = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let json = serde_json::to_string(&event).unwrap();
            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    // Keep connection alive until client disconnects
    while let Some(Ok(msg)) = ws_rx.next().await {
        if matches!(msg, Message::Close(_)) {
            break;
        }
    }
    fwd.abort();
}

#[derive(Deserialize)]
pub struct InputRequest {
    pub pane_id: Option<String>,
    pub data: String,
}

pub async fn post_input(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<InputRequest>,
) -> impl IntoResponse {
    let s = settings.read().await;
    if !s.open_api.enabled {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "open_api is disabled" })));
    }
    drop(s);

    let pane_id = req.pane_id.clone().or_else(|| {
        manager.active_pane_id.lock().unwrap().clone()
    });

    let pane_id = match pane_id {
        Some(id) if manager.sessions.contains_key(&id) => id,
        _ => {
            // Fall back to first available session
            match manager.sessions.iter().next() {
                Some(entry) => entry.key().clone(),
                None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "no active pane" }))),
            }
        }
    };

    match manager.sessions.get(&pane_id) {
        Some(session) => {
            let mut w = session.writer.lock().unwrap();
            let _ = w.write_all(req.data.as_bytes());
            (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
        }
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" }))),
    }
}
