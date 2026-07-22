use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::attention::{AttentionTarget, MarkReadResult, Severity, TargetResult, TargetStatus};

use super::types::MarkReadRequest;

pub(crate) fn conflict_mark_read(request: &MarkReadRequest, epoch: &str) -> MarkReadResult {
    let results = request
        .panes
        .iter()
        .map(|pane| TargetResult {
            target: AttentionTarget::Pane { pane_id: pane.pane_id.clone() },
            status: TargetStatus::Conflict,
        })
        .chain(request.notifs.iter().map(|notif| TargetResult {
            target: AttentionTarget::Notif { notif_id: notif.notif_id.clone() },
            status: TargetStatus::Conflict,
        }))
        .collect();
    MarkReadResult {
        request_id: request.request_id.clone(),
        epoch: epoch.to_string(),
        applied_at_revision: None,
        results,
    }
}

pub(crate) fn payload_hash<T: Serialize>(payload: &T) -> u64 {
    let mut hasher = DefaultHasher::new();
    serde_json::to_vec(payload).unwrap_or_default().hash(&mut hasher);
    hasher.finish()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub(crate) fn severity_from_type(value: &str) -> Option<Severity> {
    match value {
        "info" | "bell" => Some(Severity::Info),
        "success" => Some(Severity::Success),
        "warning" => Some(Severity::Warning),
        "error" => Some(Severity::Error),
        "urgent" => Some(Severity::Urgent),
        _ => None,
    }
}
