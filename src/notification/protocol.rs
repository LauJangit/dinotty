use serde::Serialize;

use crate::attention::{MarkReadResult, Severity, Snapshot, StateDelta};

/// Wire shape for every message flowing from server to client on the notification WebSocket.
///
/// The `Bell` and `Notify` variants intentionally retain the legacy `type:"bell"|"notify"` shape.
/// The protocol-v1 dispatcher recognizes the added `v` and authoritative identity fields first.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEnvelope {
    Bell {
        v: u64,
        pane_id: String,
        title: Option<String>,
        body: String,
        notification_type: String,
        #[serde(rename = "eventSeq")]
        event_seq: String,
        #[serde(rename = "occurredAt")]
        occurred_at: u64,
        severity: Severity,
        #[serde(rename = "notifId", skip_serializing_if = "Option::is_none")]
        notif_id: Option<String>,
    },
    Notify {
        v: u64,
        pane_id: String,
        title: Option<String>,
        body: String,
        notification_type: String,
        #[serde(rename = "eventSeq")]
        event_seq: String,
        #[serde(rename = "occurredAt")]
        occurred_at: u64,
        severity: Severity,
        #[serde(rename = "notifId", skip_serializing_if = "Option::is_none")]
        notif_id: Option<String>,
    },
    // Epoch is deliberately carried inside Snapshot/StateDelta instead of a separate envelope.
    StateDelta {
        #[serde(flatten)]
        delta: StateDelta,
    },
    Snapshot {
        #[serde(flatten)]
        snapshot: Snapshot,
    },
    MarkReadResult {
        #[serde(flatten)]
        result: MarkReadResult,
    },
    ResyncRequired {
        v: u64,
    },
}

impl ServerEnvelope {
    pub(crate) fn is_state_delta(&self) -> bool {
        matches!(self, Self::StateDelta { .. })
    }

    pub fn revision(&self) -> Option<u64> {
        match self {
            Self::StateDelta { delta } => Some(delta.revision),
            Self::Snapshot { snapshot } => Some(snapshot.revision),
            _ => None,
        }
    }
}
