//! Backend-authoritative notification attention state.
//!
//! This module deliberately contains only data and deterministic ledger logic. Transport,
//! locking, blocking dedup waiters, and producer validation belong to integration layers.

#![allow(
    clippy::expect_used,
    clippy::field_reassign_with_default,
    clippy::match_same_arms,
    clippy::must_use_candidate,
    clippy::needless_pass_by_value,
    clippy::ref_option,
    clippy::trivially_copy_pass_by_ref
)]

mod ledger;
mod types;

#[cfg(test)]
mod tests;

pub use ledger::{
    evaluate_ingest_gate, AttentionLedger, DEDUP_TTL, IDENTITY_CAP, RESERVATION_TIMEOUT,
    UNREAD_CAP, UNREAD_TTL,
};
pub use types::{
    AttentionTarget, DedupEntry, DedupOutcome, IngestGateResult, IngestSource, MarkReadResult,
    NotifAttention, NotifDelta, PaneAttention, PaneDelta, ProducerOutcome, ReserveResult, Severity,
    Snapshot, StateDelta, TargetResult, TargetStatus, UnreadEvent,
};
