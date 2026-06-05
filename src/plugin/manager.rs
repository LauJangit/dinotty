use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::session::SessionManager;

use super::helpers::*;
use super::types::*;

// ─── PluginManager ──────────────────────────────────────────────────────────

pub struct PluginManager {
    pub plugin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub registry: DashMap<String, PluginInfo>,
    pub processes: DashMap<String, DashMap<String, ManagedProcess>>,
}

pub type PluginManagerState = Arc<PluginManager>;

impl PluginManager {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        Self {
            plugin_dir: home.join(".dinotty/plugins"),
            data_dir: home.join(".dinotty/plugin-data"),
            registry: DashMap::new(),
            processes: DashMap::new(),
        }
    }

    pub async fn kill_plugin_processes(&self, plugin_id: &str) {
        if let Some((_, proc_map)) = self.processes.remove(plugin_id) {
            for entry in proc_map.iter() {
                let mut child = entry.value().child.lock().await;
                if let Some(ref mut c) = *child {
                    let _ = c.kill().await;
                }
            }
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

            // Skip broken symlinks
            if path.is_symlink() && !path.exists() {
                tracing::warn!("Removing broken symlink: {:?}", path);
                let _ = std::fs::remove_file(&path);
                continue;
            }

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

            loop {
                let Some(event) = rx.recv().await else {
                    break;
                };

                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }

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

                let old_ids: Vec<String> =
                    this.registry.iter().map(|e| e.key().clone()).collect();

                this.registry.clear();
                this.scan();

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

    // ─── Lifecycle Methods ───────────────────────────────────────────────────

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

        if let Err(e) = std::fs::rename(tmp.path(), &plugin_path) {
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
        self.kill_plugin_processes(id).await;

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
