#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{extract::State, http::StatusCode, Json};
use notify::{PollWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::session::{SyncClient, SyncMsg};

#[derive(Clone)]
pub struct HistoryState {
    inner: Arc<HistoryInner>,
}

struct HistoryInner {
    entries: RwLock<HashMap<String, usize>>,
    deleted: RwLock<HashSet<String>>,
    shell_type: String,
    history_path: PathBuf,
    watcher: std::sync::Mutex<Option<PollWatcher>>,
    sync_clients: Arc<Mutex<Vec<SyncClient>>>,
}

#[derive(Serialize, Clone)]
pub struct SuggestionItem {
    pub command: String,
    pub frequency: usize,
}

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub prefix: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct DeleteBody {
    pub command: String,
}

impl HistoryState {
    #[must_use]
    pub fn new(sync_clients: Arc<Mutex<Vec<SyncClient>>>) -> Self {
        let shell_type = crate::platform::shell::default_shell().shell_type;
        let history_path = get_history_path(&shell_type);

        let state = Self {
            inner: Arc::new(HistoryInner {
                entries: RwLock::new(HashMap::new()),
                deleted: RwLock::new(HashSet::new()),
                shell_type,
                history_path,
                watcher: std::sync::Mutex::new(None),
                sync_clients,
            }),
        };

        let s = state.clone();
        tokio::spawn(async move {
            s.load_initial().await;
            s.start_watcher();
        });

        state
    }

    async fn load_initial(&self) {
        let content = match tokio::fs::read(&self.inner.history_path).await {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return;
                }
                warn!("Failed to read history file {:?}: {}", self.inner.history_path, e);
                return;
            }
        };

        let entries = parse_history(&self.inner.shell_type, &content);
        info!("Loaded {} unique history entries from {:?}", entries.len(), self.inner.history_path);
        *self.inner.entries.write().await = entries;
        self.broadcast_top().await;
    }

    fn start_watcher(&self) {
        let path = self.inner.history_path.clone();
        if !path.exists() {
            return;
        }

        let state = self.clone();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let mut watcher = match PollWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() {
                        let _ = tx.send(());
                    }
                }
            },
            notify::Config::default().with_poll_interval(std::time::Duration::from_secs(1)),
        ) {
            Ok(w) => w,
            Err(e) => {
                warn!("Failed to create history watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&path, RecursiveMode::NonRecursive) {
            warn!("Failed to watch history file: {}", e);
            return;
        }

        *self.inner.watcher.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(watcher);

        tokio::spawn(async move {
            while rx.recv().await.is_some() {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                while rx.try_recv().is_ok() {}
                state.reload_incremental().await;
            }
        });
    }

    async fn reload_incremental(&self) {
        let content = match tokio::fs::read(&self.inner.history_path).await {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(_) => return,
        };

        let mut entries = parse_history(&self.inner.shell_type, &content);
        let deleted = self.inner.deleted.read().await;
        for cmd in deleted.iter() {
            entries.remove(cmd);
        }
        drop(deleted);
        *self.inner.entries.write().await = entries;
        self.broadcast_top().await;
    }

    async fn broadcast_top(&self) {
        let items = self.query(None, 20).await;
        let msg = SyncMsg::Suggestions { items };
        let json = serde_json::to_string(&msg).expect("serialization is infallible");
        let mut clients =
            self.inner.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        clients.retain(|c| c.tx.send(json.clone()).is_ok());
    }

    pub async fn query(&self, prefix: Option<&str>, limit: usize) -> Vec<SuggestionItem> {
        let entries = self.inner.entries.read().await;
        let mut results: Vec<_> = match prefix {
            Some(p) if !p.is_empty() => entries
                .iter()
                .filter(|(cmd, _)| cmd.starts_with(p))
                .map(|(cmd, &freq)| SuggestionItem { command: cmd.clone(), frequency: freq })
                .collect(),
            _ => entries
                .iter()
                .map(|(cmd, &freq)| SuggestionItem { command: cmd.clone(), frequency: freq })
                .collect(),
        };
        results.sort_by_key(|b| std::cmp::Reverse(b.frequency));
        results.truncate(limit);
        results
    }

    pub async fn push_realtime(&self, command: &str) {
        let cmd = command.trim().to_string();
        if cmd.is_empty() {
            return;
        }
        let deleted = self.inner.deleted.read().await;
        if deleted.contains(&cmd) {
            return;
        }
        drop(deleted);
        *self.inner.entries.write().await.entry(cmd).or_insert(0) += 1;
        self.broadcast_top().await;
    }

    pub async fn delete(&self, command: &str) {
        self.inner.deleted.write().await.insert(command.to_string());
        self.inner.entries.write().await.remove(command);
        self.broadcast_top().await;
    }
}

fn get_history_path(shell_type: &str) -> PathBuf {
    let home = crate::platform::shell::home_dir();
    match shell_type {
        "zsh" => {
            if let Ok(histfile) = std::env::var("HISTFILE") {
                return PathBuf::from(histfile);
            }
            home.join(".zsh_history")
        }
        "bash" => home.join(".bash_history"),
        "powershell" => powershell_history_path(&home),
        "cmd" => home.join(".dinotty_cmd_history"),
        _ => home.join(".sh_history"),
    }
}

fn powershell_history_path(home: &std::path::Path) -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| home.to_path_buf());

    let windows_powershell = base
        .join("Microsoft")
        .join("Windows")
        .join("PowerShell")
        .join("PSReadLine")
        .join("ConsoleHost_history.txt");
    let powershell_core = base
        .join("Microsoft")
        .join("PowerShell")
        .join("PSReadLine")
        .join("ConsoleHost_history.txt");

    if windows_powershell.exists() || !powershell_core.exists() {
        windows_powershell
    } else {
        powershell_core
    }
}

fn parse_history(shell_type: &str, content: &str) -> HashMap<String, usize> {
    let mut entries = HashMap::new();
    match shell_type {
        "zsh" => {
            let mut continuation = String::new();
            for line in content.lines() {
                if !continuation.is_empty() {
                    if let Some(stripped) = line.strip_suffix('\\') {
                        continuation.push('\n');
                        continuation.push_str(stripped);
                        continue;
                    }
                    continuation.push('\n');
                    continuation.push_str(line);
                    let cmd = continuation.trim().to_string();
                    if !cmd.is_empty() {
                        *entries.entry(cmd).or_insert(0) += 1;
                    }
                    continuation.clear();
                    continue;
                }

                let raw = if line.starts_with(": ") {
                    line.find(';').map_or("", |i| &line[i + 1..])
                } else {
                    line
                };

                if let Some(stripped) = raw.strip_suffix('\\') {
                    continuation = stripped.to_string();
                    continue;
                }

                let cmd = raw.trim();
                if !cmd.is_empty() {
                    *entries.entry(cmd.to_string()).or_insert(0) += 1;
                }
            }
            if !continuation.is_empty() {
                let cmd = continuation.trim().to_string();
                if !cmd.is_empty() {
                    *entries.entry(cmd).or_insert(0) += 1;
                }
            }
        }
        _ => {
            for line in content.lines() {
                let cmd = line.trim();
                if !cmd.is_empty() {
                    *entries.entry(cmd.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    entries
}

pub async fn get_history(
    State(state): State<HistoryState>,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Json<Vec<SuggestionItem>> {
    let limit = query.limit.unwrap_or(20).min(100);
    let results = state.query(query.prefix.as_deref(), limit).await;
    Json(results)
}

pub async fn delete_history(
    State(state): State<HistoryState>,
    Json(body): Json<DeleteBody>,
) -> StatusCode {
    state.delete(&body.command).await;
    StatusCode::NO_CONTENT
}

#[cfg(test)]
mod tests {
    use super::{parse_history, powershell_history_path};

    fn write_file(path: &std::path::Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "history").unwrap();
    }

    #[test]
    fn powershell_history_prefers_windows_powershell_when_both_exist() {
        let _env = crate::test_support::EnvGuard::new(&["APPDATA"]);
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("APPDATA", tmp.path());
        let windows_powershell = tmp
            .path()
            .join("Microsoft")
            .join("Windows")
            .join("PowerShell")
            .join("PSReadLine")
            .join("ConsoleHost_history.txt");
        let powershell_core = tmp
            .path()
            .join("Microsoft")
            .join("PowerShell")
            .join("PSReadLine")
            .join("ConsoleHost_history.txt");
        write_file(&windows_powershell);
        write_file(&powershell_core);

        assert_eq!(powershell_history_path(tmp.path()), windows_powershell);
    }

    #[test]
    fn powershell_history_uses_core_when_windows_powershell_missing() {
        let _env = crate::test_support::EnvGuard::new(&["APPDATA"]);
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("APPDATA", tmp.path());
        let powershell_core = tmp
            .path()
            .join("Microsoft")
            .join("PowerShell")
            .join("PSReadLine")
            .join("ConsoleHost_history.txt");
        write_file(&powershell_core);

        assert_eq!(powershell_history_path(tmp.path()), powershell_core);
    }

    #[test]
    fn parse_history_ignores_empty_lines_and_counts_powershell_duplicates() {
        let parsed = parse_history("powershell", "Get-ChildItem\n\n  \nGet-ChildItem\npwd\n");

        assert_eq!(parsed.get("Get-ChildItem"), Some(&2));
        assert_eq!(parsed.get("pwd"), Some(&1));
        assert!(!parsed.contains_key(""));
    }

    #[test]
    fn parse_history_ignores_empty_lines_and_counts_cmd_duplicates() {
        let parsed = parse_history("cmd", "dir\r\n\r\n dir \r\necho hi\r\n");

        assert_eq!(parsed.get("dir"), Some(&2));
        assert_eq!(parsed.get("echo hi"), Some(&1));
        assert!(!parsed.contains_key(""));
    }
}
