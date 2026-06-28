#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::State,
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    Json,
};
use futures_util::stream::Stream;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, RwLock};

use super::server::{self, JsonRpcRequest, McpServer};

pub type McpState = Arc<McpServer>;

/// Run MCP stdio transport. Reads JSON-RPC from stdin, writes to stdout.
pub async fn run_stdio(server: Arc<McpServer>) {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
                    Ok(request) => {
                        server::handle_request(&server, request, &crate::token::TokenInfo::global())
                            .await
                    }
                    Err(e) => Some(server::JsonRpcResponse::error(
                        None,
                        server::PARSE_ERROR,
                        format!("Parse error: {e}"),
                    )),
                };

                if let Some(resp) = response {
                    let json = serde_json::to_string(&resp).unwrap_or_default();
                    let _ = stdout.write_all(json.as_bytes()).await;
                    let _ = stdout.write_all(b"\n").await;
                    let _ = stdout.flush().await;
                }
            }
            Err(e) => {
                eprintln!("MCP stdin error: {e}");
                break;
            }
        }
    }
}

/// Shared SSE state for all connected clients.
pub struct SseState {
    clients: RwLock<Vec<mpsc::UnboundedSender<String>>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self::new()
    }
}

impl SseState {
    #[must_use]
    pub fn new() -> Self {
        Self { clients: RwLock::new(Vec::new()) }
    }
}

/// Custom stream wrapper for SSE that wraps an mpsc receiver.
struct MpscReceiverStream {
    rx: mpsc::UnboundedReceiver<String>,
}

impl Stream for MpscReceiverStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.rx.poll_recv(cx) {
            Poll::Ready(Some(data)) => Poll::Ready(Some(Ok(Event::default().data(data)))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// GET /mcp/sse — SSE endpoint for server-to-client messages.
pub async fn mcp_sse_handler(
    State(_server): State<McpState>,
    State(sse_state): State<Arc<SseState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = mpsc::unbounded_channel::<String>();

    // Send initial endpoint event so the client knows where to POST messages
    let _ = tx.send(
        r#"{"jsonrpc":"2.0","method":"endpoint","params":{"uri":"/mcp/message"}}"#.to_string(),
    );

    // Register this client
    {
        let mut clients = sse_state.clients.write().await;
        clients.push(tx);
    }

    let stream = MpscReceiverStream { rx };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// POST /mcp/message — Client-to-server JSON-RPC messages.
pub async fn mcp_message_handler(
    State(server): State<McpState>,
    State(sse_state): State<Arc<SseState>>,
    axum::Extension(token_info): axum::Extension<crate::token::TokenInfo>,
    Json(request): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let response = server::handle_request(&server, request, &token_info).await;

    if let Some(resp) = response {
        let json = serde_json::to_string(&resp).unwrap_or_default();

        // Broadcast response to all SSE clients, removing disconnected ones
        let mut clients = sse_state.clients.write().await;
        clients.retain(|tx| tx.send(json.clone()).is_ok());

        (StatusCode::OK, Json(resp)).into_response()
    } else {
        StatusCode::OK.into_response()
    }
}
