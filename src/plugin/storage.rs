#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use super::helpers::{is_safe_segment, plugin_err};
use super::manager::PluginManagerState;

pub async fn plugin_storage_list(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if !is_safe_segment(&id) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid plugin id");
    }
    let dir = pm.data_dir.join(&id);
    let mut keys = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if std::path::Path::new(name)
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                {
                    keys.push(name.trim_end_matches(".json").to_string());
                }
            }
        }
    }
    Json(serde_json::json!({ "keys": keys })).into_response()
}

pub async fn plugin_storage_get(
    Path((id, key)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if !is_safe_segment(&id) || !is_safe_segment(&key) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid id or key");
    }
    let path = pm.data_dir.join(&id).join(format!("{key}.json"));
    let Ok(content) = tokio::fs::read_to_string(&path).await else {
        return plugin_err(StatusCode::NOT_FOUND, "key not found");
    };
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(val) => Json(serde_json::json!({ "value": val })).into_response(),
        Err(_) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, "corrupt data"),
    }
}

/// # Panics
/// Panics if JSON serialization of the value fails (which should be infallible for `serde_json::Value`).
pub async fn plugin_storage_set(
    Path((id, key)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    if !is_safe_segment(&id) || !is_safe_segment(&key) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid id or key");
    }
    let dir = pm.data_dir.join(&id);
    let _ = tokio::fs::create_dir_all(&dir).await;
    let path = dir.join(format!("{key}.json"));
    let val = body.get("value").cloned().unwrap_or(body);
    match tokio::fs::write(&path, serde_json::to_string(&val).expect("serialization is infallible"))
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub async fn plugin_storage_delete(
    Path((id, key)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if !is_safe_segment(&id) || !is_safe_segment(&key) {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid id or key");
    }
    let path = pm.data_dir.join(&id).join(format!("{key}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
