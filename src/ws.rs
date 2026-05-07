use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use serde::{Deserialize, Serialize};
use std::{io::Write, sync::Arc};

use tracing::{error, info};

use crate::session::{SessionManager, SessionStatus, SyncMsg};

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
) -> impl IntoResponse {
    let pane_id = q.pane_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    ws.on_upgrade(move |socket| handle_socket(socket, pane_id, manager))
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
                            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id });
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

async fn handle_socket(socket: WebSocket, pane_id: String, manager: Arc<SessionManager>) {
    info!("WebSocket connected: pane={}", pane_id);
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Check if session already exists (reconnection / multi-client case)
    let existing_session = manager.sessions.get(&pane_id).map(|r| Arc::clone(r.value()));
    if let Some(session) = existing_session {
        info!("Joining existing session: pane={}", pane_id);

        *session.status.lock().unwrap() = SessionStatus::Connected;

        // Send reconnected message
        let (cols, rows) = *session.size.lock().unwrap();
        let msg = serde_json::to_string(&ServerMsg::Reconnected { cols, rows }).unwrap();
        if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }

        // Send scrollback history in chunks, then visible screen
        let (scrollback_chunks, snapshot) = {
            let screen = session.screen.lock().unwrap();
            (screen.snapshot_scrollback_chunks(200), screen.snapshot())
        };
        for chunk in &scrollback_chunks {
            let msg = serde_json::to_string(&ServerMsg::Output { data: chunk }).unwrap();
            if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }
        }
        let msg = serde_json::to_string(&ServerMsg::Output { data: &snapshot }).unwrap();
        if ws_tx.send(Message::Text(msg.into())).await.is_err() { return; }

        // Add this client to the broadcast list
        let mut rx = session.add_client();

        let fwd = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
                if ws_tx.send(Message::Text(msg.into())).await.is_err() { break; }
            }
        });

        // Read loop
        let mut normal_close = false;
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(ClientMsg::Input { data }) => {
                            let mut w = session.writer.lock().unwrap();
                            let _ = w.write_all(data.as_bytes());
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
                Message::Close(frame) => {
                    normal_close = frame.as_ref().map(|f| f.code == 1000).unwrap_or(false);
                    break;
                }
                _ => {}
            }
        }

        fwd.abort();

        if normal_close && !session.has_clients() {
            manager.sessions.remove(&pane_id);
            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: pane_id.clone() });
            info!("Session destroyed (last client closed): pane={}", pane_id);
        } else if !session.has_clients() {
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

    // WS read loop
    let mut normal_close = false;
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(ClientMsg::Input { data }) => {
                        let mut w = session.writer.lock().unwrap();
                        let _ = w.write_all(data.as_bytes());
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
            Message::Close(frame) => {
                normal_close = frame.as_ref().map(|f| f.code == 1000).unwrap_or(false);
                break;
            }
            _ => {}
        }
    }

    fwd.abort();

    if normal_close && !session.has_clients() {
        manager.sessions.remove(&pane_id);
        manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: pane_id.clone() });
        info!("Session destroyed (normal close): pane={}", pane_id);
    } else if !session.has_clients() {
        *session.status.lock().unwrap() = SessionStatus::Detached { since: std::time::Instant::now() };
        info!("Session detached (abnormal close): pane={}", pane_id);
    }
}

