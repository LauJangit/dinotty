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
mod handler;
mod types;
mod util;

use std::time::Duration;

/// Notification protocol version stamped on every `Bell`/`Notify`/`ResyncRequired`
/// envelope. The frontend dispatch uses this to detect protocol mismatches.
pub const MIN_PROTOCOL_VERSION: u64 = 1;
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

pub use broadcast::NotificationBroadcast;
pub use handler::post_notify;
pub use types::{MarkReadNotif, MarkReadPane, MarkReadReason, MarkReadRequest, NotifyRequest};
pub use util::now_ms;
