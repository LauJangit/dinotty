use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};

use crate::session::SessionManager;
use crate::settings::SettingsState;

use super::types::InputRequest;

/// # Panics
/// Panics if the internal mutex is poisoned.
pub async fn post_input(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<InputRequest>,
) -> impl IntoResponse {
    let s = settings.read().await;
    if !s.open_api.enabled {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "open_api is disabled" })),
        );
    }
    drop(s);

    let pane_id = req.pane_id.clone().or_else(|| {
        manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    });

    let pane_id = match pane_id {
        Some(id) if manager.sessions.contains_key(&id) => id,
        _ => {
            // Fall back to first available session
            match manager.sessions.iter().next() {
                Some(entry) => entry.key().clone(),
                None => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({ "error": "no active pane" })),
                    )
                }
            }
        }
    };

    match manager.sessions.get(&pane_id) {
        Some(session) => {
            let _ = session.write_input_async(req.data.as_bytes()).await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
        }
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" }))),
    }
}
