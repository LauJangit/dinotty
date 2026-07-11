//! HTTP fallback for environments where WebSocket is not available (e.g. reverse proxies).
//!
//! Uses SSE (Server-Sent Events) for server→client streaming and HTTP POST for client→server commands.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::unused_async,
    clippy::missing_panics_doc,
    clippy::too_many_lines
)]

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    Json,
};
use futures_util::stream::Stream;
use serde::Deserialize;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info};

use crate::history::HistoryState;
use crate::session::{SessionManager, SessionStatus, SyncMsg};
use crate::settings::SettingsState;
use crate::workspace_mgmt::WorkspacesState;
use crate::ws::SyncClientMsg;

#[derive(Deserialize)]
pub struct HttpTermQuery {
    #[serde(rename = "paneId")]
    pane_id: Option<String>,
}

/// SSE endpoint for terminal output: `GET /http/term?paneId=<id>`
pub async fn sse_terminal(
    Query(q): Query<HttpTermQuery>,
    State(manager): State<Arc<SessionManager>>,
    State(_history): State<HistoryState>,
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
    let pane_id = q.pane_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Check if session already exists (reconnection)
    let existing_session = manager.sessions.get(&pane_id).map(|r| Arc::clone(r.value()));

    if let Some(session) = existing_session {
        info!("[http] Joining existing session: pane={}", pane_id);

        *session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
            SessionStatus::Connected;

        // Snapshot screen state and register for broadcast atomically
        let (cols, rows, scrollback_chunks, snapshot, mut broadcast_rx) = {
            let screen = session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let (cols, rows) =
                *session.size.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let chunks = screen.snapshot_scrollback_chunks(200);
            let snap = screen.snapshot();
            let rx = session.add_client();
            (cols, rows, chunks, snap, rx)
        };

        // Send reconnected message
        let msg = serde_json::to_string(&crate::ws::ServerMsg::Reconnected { cols, rows })
            .expect("serialization is infallible");
        let _ = tx.send(msg);

        // Send scrollback chunks
        for chunk in &scrollback_chunks {
            let msg = serde_json::to_string(&crate::ws::ServerMsg::Output { data: chunk })
                .expect("serialization is infallible");
            let _ = tx.send(msg);
        }

        // Send screen snapshot
        let msg = serde_json::to_string(&crate::ws::ServerMsg::Output { data: &snapshot })
            .expect("serialization is infallible");
        let _ = tx.send(msg);

        // Forward broadcast PTY output to SSE stream
        let fwd_tx = tx.clone();
        let fwd_pane = pane_id.clone();
        tokio::spawn(async move {
            while let Some(data) = broadcast_rx.recv().await {
                let msg = serde_json::to_string(&crate::ws::ServerMsg::Output { data: &data })
                    .expect("serialization is infallible");
                if fwd_tx.send(msg).is_err() {
                    break;
                }
            }
            info!("[http] SSE forwarder (reconnect) exited: pane={}", fwd_pane);
        });

        // Detach on SSE close
        let detach_session = Arc::clone(&session);
        let detach_pane = pane_id.clone();
        tokio::spawn(async move {
            tx.closed().await;
            if !detach_session.has_clients() {
                *detach_session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                    SessionStatus::Detached { since: std::time::Instant::now() };
                info!("[http] Session detached (SSE closed): pane={}", detach_pane);
            }
        });
    } else if manager.is_pane_in_any_tab(&pane_id) {
        info!("[http] Pane {} belongs to a tab but session is gone", pane_id);
        let msg = serde_json::to_string(&crate::ws::ServerMsg::SessionExit)
            .expect("serialization is infallible");
        let _ = tx.send(msg);
    } else {
        // Create new PTY session
        info!("[http] Creating new PTY session: pane={}", pane_id);
        let (session, shell_type) = match crate::pty::create_session(&manager, &pane_id, None, None)
        {
            Ok(x) => x,
            Err(e) => {
                error!("[http] {}", e);
                let empty: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
                    Box::pin(futures_util::stream::empty());
                return Sse::new(empty).keep_alive(KeepAlive::default());
            }
        };

        let mut broadcast_rx = session.add_client();

        // Send shell info
        let msg =
            serde_json::to_string(&crate::ws::ServerMsg::ShellInfo { shell_type: &shell_type })
                .expect("serialization is infallible");
        let _ = tx.send(msg);

        // Forward broadcast PTY output to SSE stream
        let fwd_tx = tx.clone();
        let fwd_pane = pane_id.clone();
        tokio::spawn(async move {
            while let Some(data) = broadcast_rx.recv().await {
                let msg = serde_json::to_string(&crate::ws::ServerMsg::Output { data: &data })
                    .expect("serialization is infallible");
                if fwd_tx.send(msg).is_err() {
                    break;
                }
            }
            info!("[http] SSE forwarder exited: pane={}", fwd_pane);
        });

        // Detach on SSE close
        let detach_session = Arc::clone(&session);
        let detach_pane = pane_id.clone();
        tokio::spawn(async move {
            tx.closed().await;
            if !detach_session.has_clients() {
                *detach_session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                    SessionStatus::Detached { since: std::time::Instant::now() };
                info!("[http] Session detached (SSE closed): pane={}", detach_pane);
            }
        });
    }

    let stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(futures_util::stream::unfold(rx, |mut rx| async move {
            let data = rx.recv().await?;
            Some((Ok::<_, Infallible>(Event::default().data(data)), rx))
        }));

    Sse::new(stream).keep_alive(KeepAlive::default())
}

#[derive(Deserialize)]
pub struct HttpInputRequest {
    pane_id: String,
    data: String,
}

/// POST endpoint for terminal input: `POST /http/input`
pub async fn post_input(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<HttpInputRequest>,
) -> impl IntoResponse {
    let Some(session) = manager.sessions.get(&req.pane_id).map(|r| Arc::clone(r.value())) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if session.is_exited() {
        return StatusCode::GONE.into_response();
    }

    let tx_lock = session.input_tx.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(tx) = tx_lock.as_ref() {
        if tx.send(req.data).is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    StatusCode::OK.into_response()
}

#[derive(Deserialize)]
pub struct HttpResizeRequest {
    pane_id: String,
    cols: u16,
    rows: u16,
}

/// POST endpoint for terminal resize: `POST /http/resize`
pub async fn post_resize(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<HttpResizeRequest>,
) -> impl IntoResponse {
    let Some(session) = manager.sessions.get(&req.pane_id).map(|r| Arc::clone(r.value())) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    session.resize_debounced(req.cols, req.rows);
    StatusCode::OK.into_response()
}

/// SSE endpoint for sync events: `GET /http/sync`
pub async fn sse_sync(
    State(manager): State<Arc<SessionManager>>,
    State(workspaces): State<WorkspacesState>,
    State(settings): State<SettingsState>,
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Register as sync client (auto-cleaned when send fails during broadcast)
    let (_client_id, mut broadcast_rx) = manager.add_sync_client();

    // Send current tab list
    let (tabs, active_pane_id) = manager.tab_list();
    let tab_list = SyncMsg::TabList { tabs, active_pane_id };
    let msg = serde_json::to_string(&tab_list).expect("serialization is infallible");
    let _ = tx.send(msg);

    // Send current workspace list
    let ws_guard = workspaces.read().await;
    let active_workspace_id = settings.read().await.active_workspace_id.clone();
    let workspace_list =
        SyncMsg::WorkspaceList { workspaces: ws_guard.clone(), active_workspace_id };
    let msg = serde_json::to_string(&workspace_list).expect("serialization is infallible");
    let _ = tx.send(msg);
    drop(ws_guard);

    // Forward broadcast sync messages to SSE stream
    let fwd_tx = tx.clone();
    tokio::spawn(async move {
        while let Some(data) = broadcast_rx.recv().await {
            if fwd_tx.send(data).is_err() {
                break;
            }
        }
    });

    // Monitor SSH auth prompts
    let auth_mgr = Arc::clone(&manager);
    let auth_tx = tx.clone();
    tokio::spawn(async move {
        let mut known_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let current_keys: std::collections::HashSet<String> =
                auth_mgr.pending_ssh_auth.iter().map(|r| r.key().clone()).collect();
            for key in &current_keys {
                if !known_keys.contains(key) {
                    known_keys.insert(key.clone());
                    let mgr = Arc::clone(&auth_mgr);
                    let out_tx = auth_tx.clone();
                    let pane_id = key.clone();
                    tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            if !mgr.pending_ssh_auth.contains_key(&pane_id) {
                                break;
                            }
                            let prompt_data = {
                                let Some(auth) = mgr.pending_ssh_auth.get(&pane_id) else {
                                    break;
                                };
                                let mut rx = auth.prompts_rx.lock().await;
                                match rx.try_recv() {
                                    Ok(data) => Some(data),
                                    Err(tokio::sync::mpsc::error::TryRecvError::Empty) => None,
                                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                                        break
                                    }
                                }
                            };
                            if let Some(prompts) = prompt_data {
                                let msg = serde_json::json!({
                                    "type": "ssh_auth_prompt",
                                    "pane_id": pane_id,
                                    "prompts": prompts,
                                });
                                if out_tx.send(msg.to_string()).is_err() {
                                    break;
                                }
                            }
                        }
                    });
                }
            }
            known_keys.retain(|k| current_keys.contains(k));
        }
    });

    let stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(futures_util::stream::unfold(rx, |mut rx| async move {
            let data = rx.recv().await?;
            Some((Ok::<_, Infallible>(Event::default().data(data)), rx))
        }));

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// POST endpoint for sync commands: `POST /http/sync/send`
pub async fn post_sync_command(
    State(manager): State<Arc<SessionManager>>,
    Json(msg): Json<SyncClientMsg>,
) -> impl IntoResponse {
    match msg {
        SyncClientMsg::ActivateTab { pane_id } => {
            *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(pane_id.clone());
            manager.broadcast_sync(&SyncMsg::TabActivated { pane_id });
        }
        SyncClientMsg::CreateTab { layout, tab_id, pane_id } => {
            let tab_id = tab_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let leaf_id = pane_id
                .or_else(|| crate::session::first_leaf_id(&layout))
                .unwrap_or_else(|| tab_id.clone());
            *manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(leaf_id.clone());
            manager.insert_tab(
                tab_id.clone(),
                serde_json::json!({
                    "layout": layout,
                    "active_pane_id": leaf_id,
                }),
            );
            manager.broadcast_sync(&SyncMsg::TabCreated {
                tab_id,
                pane_id: leaf_id,
                layout: Some(layout),
                cwd: None,
                connection_id: None,
            });
        }
        SyncClientMsg::CloseTab { pane_id } => {
            let leaf_ids: Vec<String> = manager
                .tab_layouts
                .get(&pane_id)
                .and_then(|v| v.get("layout").cloned())
                .map(|layout| crate::session::collect_leaf_pane_ids(&layout))
                .unwrap_or_default();
            for leaf_id in &leaf_ids {
                manager.kill_and_remove(leaf_id);
            }
            manager.remove_tab(&pane_id);
            manager.purge_pane_from_layouts(&pane_id);
            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id });
        }
        SyncClientMsg::ClosePane { pane_id } => {
            manager.kill_and_remove(&pane_id);
            let before_layouts: Vec<(String, serde_json::Value)> =
                manager.tab_layouts.iter().map(|e| (e.key().clone(), e.value().clone())).collect();
            let emptied_tabs = manager.purge_pane_from_layouts(&pane_id);
            for (tab_id, old_val) in &before_layouts {
                if let Some(new_val) = manager.tab_layouts.get(tab_id) {
                    if *new_val.value() != *old_val {
                        let layout = new_val
                            .value()
                            .get("layout")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let active = new_val
                            .value()
                            .get("active_pane_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        manager.broadcast_sync(&SyncMsg::LayoutUpdated {
                            pane_id: tab_id.clone(),
                            layout,
                            active_pane_id: active,
                        });
                    }
                }
            }
            for tab_id in emptied_tabs {
                manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });
            }
        }
        SyncClientMsg::UpdateLayout { pane_id, layout, active_pane_id } => {
            manager.insert_tab(
                pane_id.clone(),
                serde_json::json!({
                    "layout": layout,
                    "active_pane_id": active_pane_id,
                }),
            );
            manager.broadcast_sync(&SyncMsg::LayoutUpdated { pane_id, layout, active_pane_id });
        }
        SyncClientMsg::SshAuthResponse { pane_id, responses } => {
            if let Some(auth) = manager.pending_ssh_auth.get(&pane_id) {
                let _ = auth.responses_tx.send(responses);
            }
        }
    }

    StatusCode::OK.into_response()
}

/// SSE endpoint for monitor data: `GET /http/monitor`
pub async fn sse_monitor(
    State(monitor): State<crate::monitor::MonitorState>,
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Send buffered history as first message
    {
        let history = monitor.snapshot_history().await;
        if !history.is_empty() {
            let history_json = serde_json::to_string(&serde_json::json!({
                "type": "history",
                "data": history
            }))
            .unwrap_or_default();
            let _ = tx.send(history_json);
        }
    }

    // Subscribe to live broadcast
    let mut broadcast_rx = monitor.subscribe();
    let fwd_tx = tx.clone();
    tokio::spawn(async move {
        loop {
            match broadcast_rx.recv().await {
                Ok(json) => {
                    if fwd_tx.send(json).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => break,
            }
        }
    });

    let stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(futures_util::stream::unfold(rx, |mut rx| async move {
            let data = rx.recv().await?;
            Some((Ok::<_, Infallible>(Event::default().data(data)), rx))
        }));

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// SSE endpoint for history suggestions: `GET /http/history`
pub async fn sse_history(
    State(history): State<HistoryState>,
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Send current suggestions immediately
    let items = history.query(None, 20).await;
    let msg = serde_json::json!({ "type": "suggestions", "items": items });
    if let Ok(json) = serde_json::to_string(&msg) {
        let _ = tx.send(json);
    }

    // Subscribe to live updates
    let mut broadcast_rx = history.subscribe();
    let fwd_tx = tx.clone();
    tokio::spawn(async move {
        loop {
            match broadcast_rx.recv().await {
                Ok(json) => {
                    if fwd_tx.send(json).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => break,
            }
        }
    });

    let stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(futures_util::stream::unfold(rx, |mut rx| async move {
            let data = rx.recv().await?;
            Some((Ok::<_, Infallible>(Event::default().data(data)), rx))
        }));

    Sse::new(stream).keep_alive(KeepAlive::default())
}
