use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};

use crate::notification::{
    MarkReadRequest, NotificationBroadcast, ServerEnvelope, CLOSE_UPGRADE_REQUIRED, DRAIN_STALL_MS,
    MIN_PROTOCOL_VERSION,
};
use crate::settings::SettingsState;

use super::types::NotificationWsQuery;

#[allow(clippy::unused_async)]
pub async fn notification_ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<NotificationWsQuery>,
    State(notifier): State<Arc<NotificationBroadcast>>,
    State(settings): State<SettingsState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let version = notification_protocol_version(q.v.as_deref());
    ws.on_upgrade(move |socket| handle_notification_socket(socket, notifier, version))
        .into_response()
}

pub(crate) fn notification_protocol_version(value: Option<&str>) -> u64 {
    value.and_then(|value| value.parse::<u64>().ok()).unwrap_or(0)
}

async fn handle_notification_socket(
    mut socket: WebSocket,
    notifier: Arc<NotificationBroadcast>,
    version: u64,
) {
    if version < MIN_PROTOCOL_VERSION {
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: CLOSE_UPGRADE_REQUIRED,
                reason: "protocol_upgrade_required".into(),
            })))
            .await;
        return;
    }

    let registration = notifier.register_client();
    let conn_id = registration.conn_id;
    let (ws_tx, mut ws_rx) = socket.split();
    let (pong_tx, mut pong_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(8);
    let writer_notifier = Arc::clone(&notifier);
    let mut data_wake = registration.data_wake;
    let mut control = registration.control;
    let mut disconnect = registration.disconnect;
    let mut writer_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        // Send `message` with the drain-stall timeout. Returns `false` if the writer must stop
        // (send error/timeout, or the message itself was a Close frame).
        async fn send_one(
            ws_tx: &mut futures_util::stream::SplitSink<WebSocket, Message>,
            message: Message,
        ) -> bool {
            let closing = matches!(message, Message::Close(_));
            match tokio::time::timeout(
                std::time::Duration::from_millis(DRAIN_STALL_MS),
                ws_tx.send(message),
            )
            .await
            {
                Ok(Ok(())) => !closing,
                Ok(Err(_)) | Err(_) => false,
            }
        }

        let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
        ping_interval.tick().await; // skip the immediate first tick

        'outer: loop {
            tokio::select! {
                biased;
                changed = disconnect.changed() => {
                    if changed.is_err() || *disconnect.borrow() {
                        let message = Message::Close(Some(CloseFrame {
                            code: close_code::RESTART,
                            reason: "notification client stalled; reconnect".into(),
                        }));
                        send_one(&mut ws_tx, message).await;
                        break 'outer;
                    }
                }
                envelope = control.recv() => {
                    let Some(envelope) = envelope else { break 'outer };
                    if !send_one(&mut ws_tx, envelope_message(envelope)).await {
                        break 'outer;
                    }
                }
                pong = pong_rx.recv() => {
                    let Some(data) = pong else { break 'outer };
                    if !send_one(&mut ws_tx, Message::Pong(data)).await {
                        break 'outer;
                    }
                }
                wake = data_wake.recv() => {
                    match wake {
                        Some(()) => {
                            // Drain the whole queue on one wake token - `take_data` returning
                            // `None` just means the queue is currently empty (NORMAL), never a
                            // reason to stop the writer.
                            while let Some(envelope) = writer_notifier.take_data(conn_id) {
                                if !send_one(&mut ws_tx, envelope_message(envelope)).await {
                                    break 'outer;
                                }
                            }
                        }
                        None => break 'outer, // wake channel closed: client unregistered
                    }
                }
                _ = ping_interval.tick() => {
                    if !send_one(&mut ws_tx, Message::Ping(vec![])).await {
                        break 'outer;
                    }
                }
            }
        }
    });

    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if pong_tx.try_send(data).is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if let Some(request) = parse_mark_read(&text) {
                            notifier.apply_mark_read(conn_id, &request);
                        } else {
                            tracing::debug!("ignoring malformed notification WebSocket message");
                        }
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
            _ = &mut writer_task => break,
        }
    }
    writer_task.abort();
    notifier.unregister_client(conn_id);
}

fn envelope_message(envelope: ServerEnvelope) -> Message {
    Message::Text(serde_json::to_string(&envelope).expect("serialization is infallible"))
}

fn parse_mark_read(text: &str) -> Option<MarkReadRequest> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value.get("type")?.as_str()? != "notification.mark_read" {
        return None;
    }
    let request: MarkReadRequest = serde_json::from_value(value).ok()?;
    if request.v < MIN_PROTOCOL_VERSION
        || request.epoch.is_empty()
        || request.client_id.is_empty()
        || request.request_id.is_empty()
        || request
            .panes
            .iter()
            .any(|pane| pane.pane_id.is_empty() || pane.through_event_seq.parse::<u64>().is_err())
        || request.notifs.iter().any(|notif| notif.notif_id.is_empty())
    {
        return None;
    }
    Some(request)
}
