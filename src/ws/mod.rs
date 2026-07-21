#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::doc_markdown,
    clippy::items_after_statements,
    clippy::needless_pass_by_value
)]

mod notification;
mod openapi;
mod sync;
mod terminal;
mod types;

pub use notification::notification_ws_handler;
pub use openapi::{handle_open_api_ws, post_input};
pub use sync::sync_handler;
pub use terminal::ws_handler;
pub use types::{ClientMsg, InputRequest, NotificationWsQuery, ServerMsg, SyncClientMsg, WsQuery};

// `notification_protocol_version` is a test-only export (used by `ws::tests`)
// and by `notification_ws_handler` within the crate. Re-export at `pub(crate)`
// so tests can reach it via `use super::*`.
#[cfg(test)]
pub(crate) use notification::notification_protocol_version;

#[cfg(test)]
mod tests;
