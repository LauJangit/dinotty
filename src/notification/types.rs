use serde::{Deserialize, Serialize};

use crate::attention::ProducerOutcome;

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadRequest {
    pub v: u64,
    pub epoch: String,
    pub client_id: String,
    pub request_id: String,
    pub reason: MarkReadReason,
    #[serde(default)]
    pub panes: Vec<MarkReadPane>,
    #[serde(default)]
    pub notifs: Vec<MarkReadNotif>,
}

#[derive(Clone, Copy, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkReadReason {
    Focus,
    TerminalInput,
    TabActivate,
    TabClose,
    PaneClose,
    Goto,
    ActiveObserved,
    Dismiss,
    ClearAll,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadPane {
    pub pane_id: String,
    pub through_event_seq: String,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadNotif {
    pub notif_id: String,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyRequest {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    // camelCase's own name for this field is "paneId"; documented legacy callers
    // (docs/notifications.en.md, scripts/notify-done.sh, users' Claude Code hooks) send the
    // original snake_case "pane_id" - accept both.
    #[serde(default, alias = "pane_id")]
    pub pane_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub body: String,
    // Legacy callers send snake_case "notification_type"; some send the shorter "type".
    #[serde(default = "default_notify_type", alias = "type", alias = "notification_type")]
    pub notification_type: String,
}

fn default_notify_type() -> String {
    "info".to_string()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ProducerProcessResult {
    Outcome(ProducerOutcome),
    Conflict,
    /// Reservation is in-flight under a zombie window; the caller should retry, not treat this
    /// as a payload conflict.
    Retry,
    Malformed(String),
}
