use std::sync::Arc;

use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::attention::ProducerOutcome;
use crate::session::SessionManager;

use super::broadcast::NotificationBroadcast;
use super::types::{NotifyRequest, ProducerProcessResult};

pub async fn post_notify(
    State((notifier, manager)): State<(Arc<NotificationBroadcast>, Arc<SessionManager>)>,
    payload: Result<Json<NotifyRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(req)) = payload else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "malformed" })))
            .into_response();
    };
    match notifier.process_notify(req, |pane_id| {
        manager.is_pane_in_any_tab(pane_id) && manager.sessions.contains_key(pane_id)
    }) {
        ProducerProcessResult::Outcome(outcome) => producer_response(outcome),
        ProducerProcessResult::Conflict => {
            (StatusCode::CONFLICT, Json(serde_json::json!({ "status": "conflict" })))
                .into_response()
        }
        ProducerProcessResult::Retry => {
            (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "retry" })))
                .into_response()
        }
        ProducerProcessResult::Malformed(error) => {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": error }))).into_response()
        }
    }
}

pub(crate) fn producer_response(outcome: ProducerOutcome) -> Response {
    match outcome {
        ProducerOutcome::AcceptedPane { pane_id, event_seq, revision } => (
            StatusCode::OK,
            Json(serde_json::json!({
                "paneId": pane_id,
                "eventSeq": event_seq.to_string(),
                "revision": revision.to_string()
            })),
        )
            .into_response(),
        ProducerOutcome::AcceptedNotif { notif_id, event_seq, revision } => (
            StatusCode::OK,
            Json(serde_json::json!({
                "notifId": notif_id,
                "eventSeq": event_seq.to_string(),
                "revision": revision.to_string()
            })),
        )
            .into_response(),
        ProducerOutcome::Suppressed { reason } => {
            (StatusCode::OK, Json(serde_json::json!({ "status": "suppressed", "reason": reason })))
                .into_response()
        }
        ProducerOutcome::NotFound => {
            (StatusCode::NOT_FOUND, Json(serde_json::json!({ "status": "not_found" })))
                .into_response()
        }
    }
}
