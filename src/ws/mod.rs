#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::doc_markdown,
    clippy::items_after_statements,
    clippy::needless_pass_by_value
)]

mod openapi;
mod sync;
mod terminal;
mod types;

pub use openapi::post_input;
pub use sync::sync_handler;
pub use terminal::ws_handler;
pub use types::{ClientMsg, InputRequest, ServerMsg, SyncClientMsg, WsQuery};

#[cfg(test)]
mod tests;
