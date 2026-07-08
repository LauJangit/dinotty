#![allow(clippy::unused_async)]

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::error;

use crate::session::{SessionManager, SyncMsg};
use crate::settings::{self, SettingsState};

#[cfg(test)]
mod tests;

/// Workspace data model.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub order: u32,
    /// References an `SshProfile.id` when this is a remote workspace.
    /// `None` means local workspace (the original behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

/// Shared state for workspace management.
pub type WorkspacesState = Arc<RwLock<Vec<Workspace>>>;

fn workspaces_path() -> PathBuf {
    settings::config_dir().join("workspaces.json")
}

/// Load workspaces from disk. Returns empty vec on any error.
pub fn load_workspaces() -> Vec<Workspace> {
    let path = workspaces_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str(&data) {
                Ok(ws) => return ws,
                Err(e) => error!("parse workspaces.json: {}", e),
            },
            Err(e) => error!("read workspaces.json: {}", e),
        }
    }
    Vec::new()
}

fn save_workspaces(ws: &[Workspace]) -> Result<(), String> {
    let dir = settings::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(ws).map_err(|e| e.to_string())?;
    std::fs::write(workspaces_path(), json).map_err(|e| e.to_string())
}

/// Create the workspaces state, loading from disk.
#[must_use]
pub fn create_workspaces_state() -> WorkspacesState {
    Arc::new(RwLock::new(load_workspaces()))
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

const SENSITIVE_DIRS: &[&str] = &["/", "/etc", "/sys", "/proc", "/dev", "/bin", "/sbin", "/usr"];

/// Validate and canonicalize a workspace path.
///
/// # Errors
/// Returns an error message if the path is invalid.
pub fn validate_workspace_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path cannot be empty".into());
    }
    if !std::path::Path::new(trimmed).is_absolute() {
        return Err("path must be absolute".into());
    }
    // Check sensitive directories before canonicalize (which may fail on non-existent)
    let check_path = trimmed.trim_end_matches('/');
    for &sensitive in SENSITIVE_DIRS {
        if check_path == sensitive {
            return Err(format!("cannot use sensitive system directory: {sensitive}"));
        }
    }
    let canonical = std::fs::canonicalize(trimmed).map_err(|e| format!("invalid path: {e}"))?;
    if !canonical.is_dir() {
        return Err("path is not a directory".into());
    }
    // Re-check after canonicalize (symlinks could point to sensitive dirs)
    let canon_str = canonical.to_string_lossy().to_string();
    for &sensitive in SENSITIVE_DIRS {
        if canon_str == sensitive {
            return Err(format!("cannot use sensitive system directory: {sensitive}"));
        }
    }
    Ok(canonical)
}

/// Derive a display name from a path (last component).
#[must_use]
pub fn derive_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    std::path::Path::new(trimmed)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "root".to_string())
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateWorkspaceReq {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    /// References an `SshProfile.id` for remote workspaces.
    #[serde(default)]
    pub connection_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateWorkspaceReq {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ReorderWorkspacesReq {
    pub ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// REST handlers
// ---------------------------------------------------------------------------

pub async fn list_workspaces(State(state): State<WorkspacesState>) -> impl IntoResponse {
    let ws = state.read().await;
    Json(serde_json::json!({ "workspaces": &*ws }))
}

pub async fn create_workspace(
    State((state, manager)): State<(WorkspacesState, Arc<SessionManager>)>,
    Json(req): Json<CreateWorkspaceReq>,
) -> impl IntoResponse {
    let (path_str, name) = if req.connection_id.is_some() {
        // Remote workspace: accept path as-is (remote path), skip local validation
        let path = req.path.trim().to_string();
        if path.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "path cannot be empty" })),
            )
                .into_response();
        }
        let name = req.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| derive_name(&path));
        (path, name)
    } else {
        // Local workspace: validate as before
        let canonical = match validate_workspace_path(&req.path) {
            Ok(p) => p,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e })))
                    .into_response();
            }
        };
        let path_str = canonical.to_string_lossy().to_string();
        let name =
            req.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| derive_name(&path_str));
        (path_str, name)
    };

    let mut ws = state.write().await;

    // Duplicate check: same path AND same connection_id
    if ws.iter().any(|w| w.path == path_str && w.connection_id == req.connection_id) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "workspace with this path already exists" })),
        )
            .into_response();
    }

    #[allow(clippy::cast_possible_truncation)]
    let order = ws.len() as u32;
    let workspace = Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: path_str,
        order,
        connection_id: req.connection_id,
    };

    ws.push(workspace.clone());
    if let Err(e) = save_workspaces(&ws) {
        error!("save workspaces: {}", e);
    }

    manager.broadcast_sync(&SyncMsg::WorkspaceCreated { workspace: workspace.clone() });

    (StatusCode::CREATED, Json(serde_json::json!(workspace))).into_response()
}

pub async fn update_workspace(
    State((state, manager)): State<(WorkspacesState, Arc<SessionManager>)>,
    Path(id): Path<String>,
    Json(req): Json<UpdateWorkspaceReq>,
) -> impl IntoResponse {
    let mut ws = state.write().await;
    let idx = ws.iter().position(|w| w.id == id);
    let Some(idx) = idx else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "workspace not found" })),
        )
            .into_response();
    };

    // Update connection_id if provided
    if req.connection_id.is_some() {
        ws[idx].connection_id.clone_from(&req.connection_id);
    }

    if let Some(new_path) = &req.path {
        let effective_connection = req.connection_id.as_ref().or(ws[idx].connection_id.as_ref());
        if effective_connection.is_some() {
            // Remote workspace: accept path as-is
            let path = new_path.trim().to_string();
            if path.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "path cannot be empty" })),
                )
                    .into_response();
            }
            // Duplicate check (excluding self)
            let conn_id = ws[idx].connection_id.clone();
            if ws
                .iter()
                .enumerate()
                .any(|(i, w)| i != idx && w.path == path && w.connection_id == conn_id)
            {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({ "error": "workspace with this path already exists" })),
                )
                    .into_response();
            }
            ws[idx].path = path;
        } else {
            // Local workspace: validate as before
            let canonical = match validate_workspace_path(new_path) {
                Ok(p) => p,
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e })))
                        .into_response();
                }
            };
            let path_str = canonical.to_string_lossy().to_string();
            // Duplicate check (excluding self)
            if ws.iter().enumerate().any(|(i, w)| i != idx && w.path == path_str) {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({ "error": "workspace with this path already exists" })),
                )
                    .into_response();
            }
            ws[idx].path = path_str;
        }
        // Auto-update name from new path if name wasn't explicitly provided
        if req.name.is_none() {
            ws[idx].name = derive_name(&ws[idx].path);
        }
    }

    if let Some(name) = &req.name {
        if !name.trim().is_empty() {
            ws[idx].name = name.trim().to_string();
        }
    }

    let workspace = ws[idx].clone();
    if let Err(e) = save_workspaces(&ws) {
        error!("save workspaces: {}", e);
    }

    manager.broadcast_sync(&SyncMsg::WorkspaceUpdated { workspace: workspace.clone() });

    Json(serde_json::json!(workspace)).into_response()
}

pub async fn delete_workspace(
    State((state, settings, manager)): State<(WorkspacesState, SettingsState, Arc<SessionManager>)>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut ws = state.write().await;
    let idx = ws.iter().position(|w| w.id == id);
    let Some(idx) = idx else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "workspace not found" })),
        )
            .into_response();
    };

    ws.remove(idx);
    // Reassign order
    #[allow(clippy::cast_possible_truncation)]
    for (i, w) in ws.iter_mut().enumerate() {
        w.order = i as u32;
    }
    drop(ws);

    if let Err(e) = save_workspaces(&state.read().await) {
        error!("save workspaces: {}", e);
    }

    // Clear active_workspace_id if it was the deleted one
    let mut s = settings.write().await;
    if s.active_workspace_id.as_deref() == Some(&id) {
        s.active_workspace_id = None;
        if let Err(e) = settings::save_settings_sync(&s) {
            error!("save settings: {}", e);
        }
    }
    drop(s);

    manager.broadcast_sync(&SyncMsg::WorkspaceDeleted { id: id.clone() });

    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn activate_workspace(
    State((settings, manager)): State<(SettingsState, Arc<SessionManager>)>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut s = settings.write().await;
    s.active_workspace_id = Some(id.clone());
    if let Err(e) = settings::save_settings_sync(&s) {
        error!("save settings: {}", e);
    }
    drop(s);

    manager.broadcast_sync(&SyncMsg::WorkspaceActivated { id: Some(id) });

    Json(serde_json::json!({ "ok": true }))
}

pub async fn deactivate_workspace(
    State((settings, manager)): State<(SettingsState, Arc<SessionManager>)>,
) -> impl IntoResponse {
    let mut s = settings.write().await;
    s.active_workspace_id = None;
    if let Err(e) = settings::save_settings_sync(&s) {
        error!("save settings: {}", e);
    }
    drop(s);

    manager.broadcast_sync(&SyncMsg::WorkspaceActivated { id: None });

    Json(serde_json::json!({ "ok": true }))
}

pub async fn reorder_workspaces(
    State((state, manager)): State<(WorkspacesState, Arc<SessionManager>)>,
    Json(req): Json<ReorderWorkspacesReq>,
) -> impl IntoResponse {
    let mut ws = state.write().await;

    // Validate all ids exist
    for id in &req.ids {
        if !ws.iter().any(|w| &w.id == id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("workspace not found: {id}") })),
            )
                .into_response();
        }
    }

    // Reassign order by the provided id sequence
    #[allow(clippy::cast_possible_truncation)]
    for (i, id) in req.ids.iter().enumerate() {
        if let Some(w) = ws.iter_mut().find(|w| &w.id == id) {
            w.order = i as u32;
        }
    }
    // Sort by order for consistent storage
    ws.sort_by_key(|w| w.order);

    if let Err(e) = save_workspaces(&ws) {
        error!("save workspaces: {}", e);
    }

    manager.broadcast_sync(&SyncMsg::WorkspaceReordered { ids: req.ids });

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// List subdirectories at a given path for workspace path selection.
#[allow(clippy::implicit_hasher)]
pub async fn list_dirs(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let path_str = params.get("path").cloned().unwrap_or_else(|| "~".to_string());
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let path = if path_str == "~" || path_str.is_empty() {
        home.clone()
    } else if let Some(rest) = path_str.strip_prefix("~/") {
        home.join(rest)
    } else if path_str == "~" {
        home.clone()
    } else {
        PathBuf::from(&path_str)
    };

    if !path.is_dir() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "not a directory" })))
            .into_response();
    }

    let result = tokio::task::spawn_blocking(move || {
        let mut entries: Vec<String> = match std::fs::read_dir(&path) {
            Ok(rd) => rd
                .filter_map(std::result::Result::ok)
                .filter(|e| e.path().is_dir())
                .filter(|e| {
                    let name = e.file_name();
                    !name.to_string_lossy().starts_with('.')
                })
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect(),
            Err(e) => return Err(e.to_string()),
        };
        entries.sort();
        Ok((path.to_string_lossy().into_owned(), entries))
    })
    .await;

    match result {
        Ok(Ok((path_str, entries))) => Json(serde_json::json!({
            "path": path_str,
            "dirs": entries
        }))
        .into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
            .into_response(),
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
                .into_response()
        }
    }
}
