#![allow(
    clippy::duration_suboptimal_units,
    clippy::expect_used,
    clippy::if_not_else,
    clippy::manual_let_else,
    clippy::must_use_candidate,
    clippy::needless_pass_by_value,
    clippy::too_many_lines,
    clippy::unused_async
)]

mod broadcast;
mod client;
mod handler;
mod protocol;
mod queue;
mod types;
mod util;

#[cfg(test)]
mod tests;

use std::time::Duration;

/// Notification WebSocket protocol and queue limits. Data uses a bounded wakeup lane plus the
/// mutex-owned FIFO so overflowing clients can selectively discard state deltas. Control messages
/// are independently bounded and are never silently dropped.
pub const MIN_PROTOCOL_VERSION: u64 = 1;
pub const CLOSE_UPGRADE_REQUIRED: u16 = 4001;
pub const DATA_QUEUE_MSGS: usize = 256;
pub const DATA_QUEUE_BYTES: usize = 1024 * 1024;
pub const CONTROL_QUEUE_MSGS: usize = 64;
pub const DRAIN_STALL_MS: u64 = 10_000;
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

pub type ConnId = u64;

pub use broadcast::NotificationBroadcast;
pub use client::ClientRegistration;
pub use handler::post_notify;
pub use protocol::ServerEnvelope;
pub use types::{MarkReadNotif, MarkReadPane, MarkReadReason, MarkReadRequest, NotifyRequest};
pub use util::now_ms;
