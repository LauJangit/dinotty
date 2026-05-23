use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;

use crate::session::SessionManager;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "minAppVersion")]
    pub min_app_version: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub entry: Option<String>,
    pub bin: Option<BinConfig>,
    pub commands: Option<Vec<CommandDef>>,
    pub styles: Option<String>,
    pub permissions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BinConfig {
    pub mode: String,
    pub entry: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandDef {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub install_date: Option<u64>,
    pub state: PluginStateValue,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginStateValue {
    Active,
    Error,
}

#[derive(Deserialize)]
pub struct ExecRequest {
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub timeout: Option<u64>,
}

#[derive(Serialize)]
pub struct ExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Deserialize)]
pub struct DevLinkRequest {
    pub path: String,
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    pub keep_data: bool,
}

#[derive(Deserialize)]
pub struct SpawnQuery {
    pub args: String,
}

// ─── PluginManager ────────────────────────────────────────────────────────────

pub struct PluginManager {
    pub plugin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub registry: DashMap<String, PluginInfo>,
}

pub type PluginManagerState = Arc<PluginManager>;

impl PluginManager {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        Self {
            plugin_dir: home.join(".dinotty/plugins"),
            data_dir: home.join(".dinotty/plugin-data"),
            registry: DashMap::new(),
        }
    }

    pub fn scan(&self) {
        if !self.plugin_dir.exists() {
            return;
        }
        let Ok(entries) = std::fs::read_dir(&self.plugin_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("plugin.json");
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                    if manifest.id != entry.file_name().to_string_lossy() {
                        continue;
                    }
                    let install_date = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());
                    self.registry.insert(
                        manifest.id.clone(),
                        PluginInfo {
                            manifest,
                            install_date,
                            state: PluginStateValue::Active,
                            error: None,
                        },
                    );
                }
            }
        }
    }

    pub fn list(&self) -> Vec<PluginManifest> {
        self.registry.iter().map(|r| r.manifest.clone()).collect()
    }

    /// Start a background file watcher on the plugin directory.
    /// When files change, re-scans and broadcasts `PluginChanged` events via the sync channel.
    pub fn watch_changes(self: &Arc<Self>, manager: Arc<SessionManager>) {
        if !self.plugin_dir.exists() {
            return;
        }
        let plugin_dir = self.plugin_dir.clone();
        let this = Arc::clone(self);

        tokio::spawn(async move {
            use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

            let mut watcher = match RecommendedWatcher::new(
                move |res: Result<notify::Event, notify::Error>| {
                    if let Ok(event) = res {
                        let _ = tx.send(event);
                    }
                },
                Config::default().with_poll_interval(Duration::from_secs(1)),
            ) {
                Ok(w) => w,
                Err(e) => {
                    tracing::error!("Failed to create plugin watcher: {}", e);
                    return;
                }
            };

            if let Err(e) = watcher.watch(&plugin_dir, RecursiveMode::Recursive) {
                tracing::error!("Failed to watch plugin dir: {}", e);
                return;
            }

            tracing::info!("Plugin file watcher started on {:?}", plugin_dir);

            // Debounce: collect events for 500ms, then process once
            loop {
                let Some(event) = rx.recv().await else {
                    break;
                };

                // Check event kind — only react to content changes
                // (ignore Access events which also match Modify)
                let dominated_by_access = matches!(event.kind, EventKind::Access(_));
                if dominated_by_access {
                    continue;
                }

                // Drain additional events for 500ms (debounce window)
                let debounce = tokio::time::sleep(Duration::from_millis(500));
                tokio::pin!(debounce);
                loop {
                    tokio::select! {
                        _ = &mut debounce => break,
                        next = rx.recv() => {
                            if next.is_none() { return; }
                        }
                    }
                }

                // Snapshot old plugin IDs
                let old_ids: Vec<String> =
                    this.registry.iter().map(|e| e.key().clone()).collect();

                // Re-scan
                this.registry.clear();
                this.scan();

                // Diff
                let new_ids: Vec<String> =
                    this.registry.iter().map(|e| e.key().clone()).collect();

                for id in &new_ids {
                    if !old_ids.contains(id) {
                        manager.broadcast_plugin_changed(id.clone(), "added".into());
                    } else {
                        manager.broadcast_plugin_changed(id.clone(), "updated".into());
                    }
                }
                for id in &old_ids {
                    if !new_ids.contains(id) {
                        manager.broadcast_plugin_changed(id.clone(), "deleted".into());
                    }
                }
            }
        });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.id.is_empty() {
        return Err("id is required".into());
    }
    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("id must match [a-z0-9-]".into());
    }
    if manifest.name.is_empty() {
        return Err("name is required".into());
    }
    if manifest.version.is_empty() {
        return Err("version is required".into());
    }
    Ok(())
}

fn set_executable(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

fn extract_tar_gz(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    let decoder = GzDecoder::new(Cursor::new(data));
    let mut archive = tar::Archive::new(decoder);
    archive.set_overwrite(false);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        if path.components().any(|c| c == std::path::Component::ParentDir) {
            return Err("archive contains path traversal (..)".into());
        }
    }

    // Re-create archive to actually unpack (entries() consumed the iterator)
    let decoder2 = GzDecoder::new(Cursor::new(data));
    let mut archive2 = tar::Archive::new(decoder2);
    archive2.unpack(dest).map_err(|e| e.to_string())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn plugin_err(status: StatusCode, msg: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": msg })),
    )
        .into_response()
}

fn is_safe_segment(s: &str) -> bool {
    !s.is_empty() && !s.contains('/') && !s.contains('\\') && s != ".." && s != "."
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_plugins(State(pm): State<PluginManagerState>) -> Json<Vec<PluginManifest>> {
    Json(pm.list())
}

pub async fn plugin_detail(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Result<Json<PluginInfo>, StatusCode> {
    pm.registry
        .get(&id)
        .map(|info| Json(info.clone()))
        .ok_or(StatusCode::NOT_FOUND)
}

pub async fn plugin_asset(
    Path((id, subpath)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    if subpath.contains("..") {
        return plugin_err(StatusCode::BAD_REQUEST, "invalid path");
    }

    let plugin_path = pm.plugin_dir.join(&id);
    let file_path = plugin_path.join(&subpath);

    // Resolve symlinks and verify path stays within plugin dir
    let canonical = match std::fs::canonicalize(&file_path) {
        Ok(p) => p,
        Err(_) => return plugin_err(StatusCode::NOT_FOUND, "file not found"),
    };
    let canonical_plugin = match std::fs::canonicalize(&plugin_path) {
        Ok(p) => p,
        Err(_) => return plugin_err(StatusCode::NOT_FOUND, "plugin not found"),
    };
    if !canonical.starts_with(&canonical_plugin) {
        return plugin_err(StatusCode::FORBIDDEN, "access denied");
    }

    let content = match tokio::fs::read(&file_path).await {
        Ok(c) => c,
        Err(_) => return plugin_err(StatusCode::NOT_FOUND, "file not found"),
    };
    let mime = mime_guess::from_path(&file_path).first_or_octet_stream();

    Response::builder()
        .header("Content-Type", mime.as_ref())
        .header("Cache-Control", "no-cache")
        .body(Body::from(content))
        .unwrap()
}

pub async fn plugin_exec(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
    Json(body): Json<ExecRequest>,
) -> Response {
    let info = match pm.registry.get(&id) {
        Some(i) => i,
        None => return plugin_err(StatusCode::NOT_FOUND, "plugin not found"),
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b,
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };

    let bin_path = pm.plugin_dir.join(&id).join(&bin.entry);
    let mut cmd = Command::new(&bin_path);
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }
    if let Some(ref env) = body.env {
        cmd.envs(env);
    }

    let timeout_ms = body.timeout.unwrap_or(30_000);
    let timeout_dur = std::time::Duration::from_millis(timeout_ms);

    match tokio::time::timeout(timeout_dur, cmd.output()).await {
        Ok(Ok(output)) => Json(ExecResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
        .into_response(),
        Ok(Err(e)) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(_) => Json(ExecResult {
            code: -1,
            stdout: String::new(),
            stderr: format!("timeout after {timeout_ms}ms"),
        })
        .into_response(),
    }
}

pub async fn plugin_spawn_ws(
    Path(id): Path<String>,
    Query(params): Query<SpawnQuery>,
    State(pm): State<PluginManagerState>,
    ws: axum::extract::WebSocketUpgrade,
) -> Response {
    let info = match pm.registry.get(&id) {
        Some(i) => i,
        None => return plugin_err(StatusCode::NOT_FOUND, "plugin not found"),
    };
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b.clone(),
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };
    let plugin_dir = pm.plugin_dir.join(&id);

    let args: Vec<String> = match serde_json::from_str(&params.args) {
        Ok(a) => a,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid args: {e}")),
    };

    ws.on_upgrade(move |mut socket| async move {

        use tokio::io::{AsyncBufReadExt, BufReader};

        let bin_path = plugin_dir.join(&bin.entry);
        let mut child = match Command::new(&bin_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "stderr", "data": e.to_string()}).to_string(),
                    ))
                    .await;
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "done"}).to_string(),
                    ))
                    .await;
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let tx2 = tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                if tx2
                    .send(
                        serde_json::json!({"type": "stdout", "data": line + "\n"}).to_string(),
                    )
                    .is_err()
                {
                    break;
                }
            }
        });

        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                if tx
                    .send(
                        serde_json::json!({"type": "stderr", "data": line + "\n"}).to_string(),
                    )
                    .is_err()
                {
                    break;
                }
            }
        });

        loop {
            tokio::select! {
                Some(msg) = rx.recv() => {
                    if socket.send(axum::extract::ws::Message::Text(msg)).await.is_err() {
                        let _ = child.kill().await;
                        break;
                    }
                }
                msg = socket.recv() => {
                    match msg {
                        None => {
                            // WebSocket closed by client, kill child process
                            let _ = child.kill().await;
                            break;
                        }
                        Some(_) => {
                            // Client messages ignored; client can close WS to kill
                        }
                    }
                }
                status = child.wait() => {
                    let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
                    let _ = socket
                        .send(axum::extract::ws::Message::Text(
                            serde_json::json!({"type": "done", "code": code}).to_string(),
                        ))
                        .await;
                    break;
                }
            }
        }
    })
}

// ─── Storage Handlers ─────────────────────────────────────────────────────────

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
                if name.ends_with(".json") {
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
    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(_) => return plugin_err(StatusCode::NOT_FOUND, "key not found"),
    };
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(val) => Json(serde_json::json!({ "value": val })).into_response(),
        Err(_) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, "corrupt data"),
    }
}

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
    match tokio::fs::write(&path, serde_json::to_string(&val).unwrap()).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
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
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── Install / Update / Delete ────────────────────────────────────────────────

pub async fn install_plugin(
    State(pm): State<PluginManagerState>,
    mut multipart: Multipart,
) -> Response {
    let field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return plugin_err(StatusCode::BAD_REQUEST, "no file"),
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };
    let data = match field.bytes().await {
        Ok(d) => d,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };

    match pm.install(&data).await {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

pub async fn update_plugin(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
    mut multipart: Multipart,
) -> Response {
    let field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return plugin_err(StatusCode::BAD_REQUEST, "no file"),
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };
    let data = match field.bytes().await {
        Ok(d) => d,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e.to_string()),
    };

    match pm.update(&id, &data).await {
        Ok(manifest) => Json(manifest).into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

pub async fn delete_plugin(
    Path(id): Path<String>,
    Query(query): Query<DeleteQuery>,
    State(pm): State<PluginManagerState>,
) -> Response {
    match pm.delete(&id, query.keep_data).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

// ─── PluginManager Lifecycle Methods ──────────────────────────────────────────

impl PluginManager {
    pub async fn install(&self, archive: &[u8]) -> Result<PluginManifest, String> {
        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        extract_tar_gz(archive, tmp.path())?;

        let manifest_path = tmp.path().join("plugin.json");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|_| "plugin.json not found in archive".to_string())?;
        let manifest: PluginManifest =
            serde_json::from_str(&content).map_err(|e| format!("invalid plugin.json: {e}"))?;

        validate_manifest(&manifest)?;

        let dest = self.plugin_dir.join(&manifest.id);
        if dest.exists() {
            return Err(format!(
                "plugin '{}' already installed, use update instead",
                manifest.id
            ));
        }

        std::fs::create_dir_all(&self.plugin_dir).map_err(|e| e.to_string())?;
        std::fs::rename(tmp.path(), &dest).map_err(|e| e.to_string())?;

        if let Some(ref bin) = manifest.bin {
            set_executable(&dest.join(&bin.entry))?;
        }

        self.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                ),
                state: PluginStateValue::Active,
                error: None,
            },
        );

        Ok(manifest)
    }

    pub async fn update(&self, id: &str, archive: &[u8]) -> Result<PluginManifest, String> {
        let old_info = self
            .registry
            .get(id)
            .ok_or_else(|| format!("plugin '{id}' not installed"))?
            .clone();

        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        extract_tar_gz(archive, tmp.path())?;

        let manifest: PluginManifest = serde_json::from_str(
            &std::fs::read_to_string(tmp.path().join("plugin.json"))
                .map_err(|_| "plugin.json not found".to_string())?,
        )
        .map_err(|e| format!("invalid plugin.json: {e}"))?;

        validate_manifest(&manifest)?;
        if manifest.id != id {
            return Err("plugin id in archive does not match".into());
        }

        let plugin_path = self.plugin_dir.join(id);
        let backup = tempfile::tempdir().map_err(|e| e.to_string())?;
        if plugin_path.exists() {
            copy_dir_all(&plugin_path, backup.path())?;
            std::fs::remove_dir_all(&plugin_path).map_err(|e| e.to_string())?;
        }

        // Install new version; on failure restore backup
        if let Err(e) = std::fs::rename(tmp.path(), &plugin_path) {
            // Restore backup
            if plugin_path.exists() {
                let _ = std::fs::remove_dir_all(&plugin_path);
            }
            if backup.path().exists() {
                let _ = std::fs::rename(backup.path(), &plugin_path);
            }
            return Err(format!("failed to install update: {e}"));
        }

        if let Some(ref bin) = manifest.bin {
            set_executable(&plugin_path.join(&bin.entry))?;
        }

        self.registry.insert(
            id.to_string(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: old_info.install_date,
                state: PluginStateValue::Active,
                error: None,
            },
        );

        Ok(manifest)
    }

    pub async fn delete(&self, id: &str, keep_data: bool) -> Result<(), String> {
        let plugin_path = self.plugin_dir.join(id);
        if plugin_path.exists() {
            std::fs::remove_dir_all(&plugin_path).map_err(|e| e.to_string())?;
        }

        if !keep_data {
            let data_path = self.data_dir.join(id);
            if data_path.exists() {
                std::fs::remove_dir_all(&data_path).map_err(|e| e.to_string())?;
            }
        }

        self.registry.remove(id);
        Ok(())
    }
}

// ─── Dev-Link ─────────────────────────────────────────────────────────────────

pub async fn dev_link_plugin(
    State(pm): State<PluginManagerState>,
    Json(body): Json<DevLinkRequest>,
) -> Response {
    let src = match std::fs::canonicalize(&body.path) {
        Ok(p) => p,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid path: {e}")),
    };

    let manifest_path = src.join("plugin.json");
    let content = match std::fs::read_to_string(&manifest_path) {
        Ok(c) => c,
        Err(_) => return plugin_err(StatusCode::BAD_REQUEST, "plugin.json not found"),
    };
    let manifest: PluginManifest = match serde_json::from_str(&content) {
        Ok(m) => m,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid plugin.json: {e}")),
    };

    if let Err(e) = validate_manifest(&manifest) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }

    let link = pm.plugin_dir.join(&manifest.id);
    if link.exists() {
        let _ = std::fs::remove_file(&link);
    }

    std::fs::create_dir_all(&pm.plugin_dir).ok();
    if let Err(e) = std::os::unix::fs::symlink(&src, &link) {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }

    pm.registry.insert(
        manifest.id.clone(),
        PluginInfo {
            manifest: manifest.clone(),
            install_date: None,
            state: PluginStateValue::Active,
            error: None,
        },
    );

    Json(manifest).into_response()
}
