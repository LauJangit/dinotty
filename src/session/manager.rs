use super::layout::{
    collect_leaf_pane_ids, collect_terminal_leaf_pane_ids, ensure_leaf_kind, first_leaf_id,
    layout_has_pane, remove_pane_from_layout,
};
use super::Session;
use crate::attention::{MarkReadResult, Severity, Snapshot, StateDelta};
use crate::event_bus::EventBus;
use crate::workspace_mgmt::Workspace;
use dashmap::DashMap;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicU16, Ordering},
    Arc, Mutex,
};
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::info;

pub enum SessionStatus {
    Connected,
    Detached { since: Instant },
}

pub struct SyncClient {
    pub id: String,
    pub tx: mpsc::UnboundedSender<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMsg {
    TabList {
        tabs: Vec<TabInfo>,
        active_pane_id: Option<String>,
    },
    TabCreated {
        tab_id: String,
        pane_id: String,
        layout: Option<serde_json::Value>,
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        connection_id: Option<String>,
    },
    TabClosed {
        pane_id: String,
    },
    TabActivated {
        pane_id: String,
    },
    LayoutUpdated {
        pane_id: String,
        layout: serde_json::Value,
        active_pane_id: String,
    },
    PluginChanged {
        plugin_id: String,
        change: String,
    },
    ProcessExited {
        plugin_id: String,
        pid: u32,
        exit_code: Option<i32>,
    },
    CommandFinished {
        pane_id: String,
        command: String,
        exit_code: i32,
        duration_ms: u64,
        stdout: String,
        method: String,
    },
    WorkspaceCreated {
        workspace: Workspace,
    },
    WorkspaceUpdated {
        workspace: Workspace,
    },
    WorkspaceDeleted {
        id: String,
    },
    WorkspaceActivated {
        id: Option<String>,
    },
    WorkspaceReordered {
        ids: Vec<String>,
    },
    WorkspaceList {
        workspaces: Vec<Workspace>,
        active_workspace_id: Option<String>,
    },
    Event {
        #[serde(skip_serializing_if = "Option::is_none")]
        source_pane_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_plugin_id: Option<String>,
        event_name: String,
        data: serde_json::Value,
    },
    SyncHello {
        client_id: String,
    },
    Bell {
        v: u64,
        pane_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
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
        #[serde(skip_serializing_if = "Option::is_none")]
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
    Suggestions {
        items: Vec<crate::history::SuggestionItem>,
    },
    MonitorData {
        data: serde_json::Value,
    },
    MonitorHistory {
        data: Vec<serde_json::Value>,
    },
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub tab_id: String,
    pub pane_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// The `SshProfile.id` if this tab is an SSH session created from a profile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

pub(crate) fn parse_reap_secs(raw: Option<String>) -> u64 {
    raw.and_then(|v| v.parse::<u64>().ok()).unwrap_or(5_400)
}

pub struct SessionManager {
    pub sessions: DashMap<String, Arc<Session>>,
    pub sync_clients: Arc<Mutex<Vec<SyncClient>>>,
    pub active_pane_id: Arc<Mutex<Option<String>>>,
    pub tab_layouts: DashMap<String, serde_json::Value>,
    pub pending_ssh_auth: DashMap<String, crate::session::backend::PendingSshAuth>,
    pub tab_order: Mutex<Vec<String>>,
    pub event_bus: EventBus,
    notify_port: AtomicU16,
    /// Set once (via `register_notifier`) so any authoritative pane-removal site - including
    /// natural PTY/SSH exit, which never goes through `kill_and_remove` - can notify the
    /// attention ledger without threading a notifier handle through every call site.
    notifier: std::sync::OnceLock<Arc<crate::notification::NotificationBroadcast>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            sync_clients: Arc::new(Mutex::new(Vec::new())),
            active_pane_id: Arc::new(Mutex::new(None)),
            tab_layouts: DashMap::new(),
            tab_order: Mutex::new(Vec::new()),
            pending_ssh_auth: DashMap::new(),
            event_bus: EventBus::new(),
            notify_port: AtomicU16::new(0),
            notifier: std::sync::OnceLock::new(),
        }
    }

    /// Notifies the attention ledger that `pane_id` was authoritatively removed, if a notifier
    /// has been registered (via `register_notifier`). No-op otherwise (e.g. in unit tests that
    /// construct a bare `SessionManager`).
    pub(crate) fn pane_closed_notify(&self, pane_id: &str) {
        if let Some(notifier) = self.notifier.get() {
            notifier.pane_closed(pane_id);
        }
    }

    #[must_use]
    pub fn notify_port(&self) -> u16 {
        self.notify_port.load(Ordering::Relaxed)
    }

    pub fn set_notify_port(&self, port: u16) {
        self.notify_port.store(port, Ordering::Relaxed);
    }

    /// Insert a tab layout and record its order position.
    pub fn insert_tab(&self, tab_id: String, value: serde_json::Value) {
        let mut order = self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !order.contains(&tab_id) {
            order.push(tab_id.clone());
        }
        drop(order);
        self.tab_layouts.insert(tab_id, value);
    }

    /// Remove a tab layout and its order entry.
    pub fn remove_tab(&self, tab_id: &str) {
        self.tab_layouts.remove(tab_id);
        let mut order = self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        order.retain(|id| id != tab_id);
    }

    /// Check if a `pane_id` belongs to any registered tab layout.
    /// Used to prevent creating fallback PTY sessions for SSH panes.
    pub fn is_pane_in_any_tab(&self, pane_id: &str) -> bool {
        for entry in &self.tab_layouts {
            if let Some(layout) = entry.value().get("layout") {
                if layout_has_pane(layout, pane_id) {
                    return true;
                }
            }
        }
        false
    }

    /// # Panics
    /// Panics if `SyncMsg` serialization fails (should be infallible).
    #[allow(clippy::expect_used)]
    pub fn broadcast_sync(&self, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let mut clients =
            self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        clients.retain(|c| c.tx.send(json.clone()).is_ok());
    }

    /// Broadcast to all sync clients except the one with the given ID.
    ///
    /// # Panics
    /// Panics if `SyncMsg` serialization fails (should be infallible).
    #[allow(clippy::expect_used)]
    pub fn broadcast_sync_others(&self, msg: &SyncMsg, exclude_id: &str) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let mut clients =
            self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        clients.retain(|c| {
            if c.id == exclude_id {
                true // keep in list but don't send
            } else {
                c.tx.send(json.clone()).is_ok()
            }
        });
    }

    /// Send a message to a single sync client by ID. Returns `true` if the client was found
    /// (the send may still fail silently if the client's channel is closed, in which case the
    /// client is reaped on the next broadcast). Used by the notification subsystem to route
    /// `MarkReadResult` back to the origin client.
    ///
    /// # Panics
    /// Panics if `SyncMsg` serialization fails (should be infallible).
    #[allow(clippy::expect_used)]
    pub fn broadcast_sync_to(&self, target_id: &str, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let clients = self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for client in clients.iter() {
            if client.id == target_id {
                let _ = client.tx.send(json.clone());
                break;
            }
        }
    }

    pub fn add_sync_client(&self) -> (String, mpsc::UnboundedReceiver<String>) {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::unbounded_channel();
        self.sync_clients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(SyncClient { id: id.clone(), tx });
        (id, rx)
    }

    pub fn broadcast_plugin_changed(&self, plugin_id: String, change: String) {
        self.broadcast_sync(&SyncMsg::PluginChanged { plugin_id, change });
    }

    /// Remove a session from the `DashMap` and explicitly kill its child process.
    /// Returns true if the session existed.
    ///
    /// This is necessary because the PTY reader task holds an `Arc<Session>`,
    /// preventing `Drop` from firing when we only remove from the `DashMap`.
    /// By killing the child first, the reader's `read()` returns Err/Ok(0),
    /// causing it to exit and release its `Arc`.
    pub fn kill_and_remove(&self, pane_id: &str) -> bool {
        if let Some((_, session)) = self.sessions.remove(pane_id) {
            session.kill_child();
            // Drop the input channel sender so the writer task's recv() returns
            // None and the task exits, releasing its Arc<Session>.
            session.input_tx.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
            self.pane_closed_notify(pane_id);
            true
        } else {
            false
        }
    }

    /// Remove a `pane_id` from all parent tab layouts. If removing it causes
    /// a split to have only one child, the split collapses into that child.
    /// Returns the list of tab IDs whose layouts became empty (i.e. the pane
    /// was the last leaf) so the caller can broadcast `TabClosed` for them.
    pub fn purge_pane_from_layouts(&self, pane_id: &str) -> Vec<String> {
        let mut updates: Vec<(String, serde_json::Value)> = Vec::new();
        let mut emptied_tabs: Vec<String> = Vec::new();

        for entry in &self.tab_layouts {
            let tab_pane_id = entry.key();
            if tab_pane_id == pane_id {
                continue;
            }
            let val = entry.value();
            let Some(layout) = val.get("layout") else { continue };
            match remove_pane_from_layout(layout, pane_id) {
                None => {
                    // The pane was the only leaf - tab is now empty
                    emptied_tabs.push(tab_pane_id.clone());
                }
                Some(new_layout) if new_layout != *layout => {
                    let active = val.get("active_pane_id").and_then(|v| v.as_str());
                    let new_leaf_ids = collect_leaf_pane_ids(&new_layout);
                    let active_pane_id =
                        active.filter(|id| new_leaf_ids.iter().any(|lid| lid == *id));
                    let mut new_val = serde_json::json!({ "layout": new_layout });
                    if let Some(a) = active_pane_id {
                        new_val["active_pane_id"] = serde_json::Value::String(a.to_string());
                    }
                    updates.push((tab_pane_id.clone(), new_val));
                }
                _ => {}
            }
        }

        for (key, val) in updates {
            self.insert_tab(key, val);
        }
        for tab_id in &emptied_tabs {
            self.remove_tab(tab_id);
        }
        emptied_tabs
    }

    pub fn tab_list(&self) -> (Vec<TabInfo>, Option<String>) {
        // Prune stale tab layouts whose terminal leaves no longer have PTY sessions.
        // Leaves with kind=plugin|files|web have no PTY and are exempt - a tab with
        // only non-terminal leaves is NOT stale.
        let stale: Vec<String> = {
            self.tab_layouts
                .iter()
                .filter_map(|e| {
                    let v = e.value();
                    let layout = v.get("layout")?;
                    let all_leaf_ids = collect_leaf_pane_ids(layout);
                    if all_leaf_ids.is_empty() {
                        return Some(e.key().clone());
                    }
                    // Only terminal leaves require a live PTY session.
                    let terminal_ids = collect_terminal_leaf_pane_ids(layout);
                    if terminal_ids.iter().any(|id| !self.sessions.contains_key(id)) {
                        return Some(e.key().clone());
                    }
                    None
                })
                .collect()
        };
        for key in &stale {
            self.tab_layouts.remove(key);
        }
        if !stale.is_empty() {
            let mut order =
                self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            order.retain(|id| !stale.contains(id));
        }

        let order = self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let order_index = |tab_id: &str| -> usize {
            order.iter().position(|id| id == tab_id).unwrap_or(usize::MAX)
        };

        let mut tabs: Vec<TabInfo> = self
            .tab_layouts
            .iter()
            .map(|e| {
                let tab_id = e.key().clone();
                let v = e.value();
                let layout = v.get("layout").cloned().map(ensure_leaf_kind);
                let pane_id =
                    layout.as_ref().and_then(first_leaf_id).unwrap_or_else(|| tab_id.clone());
                let active_pane_id =
                    v.get("active_pane_id").and_then(|v| v.as_str()).map(String::from);
                let cwd = self.sessions.get(&pane_id).and_then(|s| {
                    s.cwd_state.lock().ok().map(|state| state.cwd.to_string_lossy().to_string())
                });
                let connection_id = self
                    .sessions
                    .get(&pane_id)
                    .and_then(|s| s.ssh_params.as_ref().and_then(|p| p.profile_id.clone()));
                TabInfo { tab_id, pane_id, layout, active_pane_id, cwd, connection_id }
            })
            .collect();

        tabs.sort_by_key(|t| order_index(&t.tab_id));
        drop(order);

        let active =
            self.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        (tabs, active)
    }

    /// When a PTY exits, find the parent tab and either remove it (single-pane)
    /// or update the layout (multi-pane). Returns the tab-level `pane_id` for
    /// single-pane tabs so the caller can broadcast `TabClosed`.
    pub fn on_pty_exited(&self, leaf_pane_id: &str) -> Option<String> {
        // Find the tab layout that contains this leaf
        let mut found_tab_id: Option<String> = None;
        for entry in &self.tab_layouts {
            let tab_id = entry.key();
            let val = entry.value();
            if let Some(layout) = val.get("layout") {
                let leaf_ids = collect_leaf_pane_ids(layout);
                if leaf_ids.iter().any(|id| id == leaf_pane_id) {
                    found_tab_id = Some(tab_id.clone());
                    break;
                }
            }
        }

        let tab_id = found_tab_id?;

        // Get the current layout for this tab
        let tab_val = self.tab_layouts.get(&tab_id)?;
        let layout = tab_val.value().get("layout")?.clone();
        let leaf_ids = collect_leaf_pane_ids(&layout);

        if leaf_ids.len() <= 1 {
            // Single-pane tab - remove the whole tab
            drop(tab_val);
            self.remove_tab(&tab_id);
            Some(tab_id)
        } else {
            // Multi-pane tab - update the layout by removing the exited pane
            let new_layout = remove_pane_from_layout(&layout, leaf_pane_id)?;
            let new_leaf_ids = collect_leaf_pane_ids(&new_layout);
            let active = tab_val.value().get("active_pane_id").and_then(|v| v.as_str());
            let active_pane_id = active
                .filter(|id| new_leaf_ids.iter().any(|lid| lid == *id))
                .or_else(|| new_leaf_ids.first().map(std::string::String::as_str))
                .unwrap_or("")
                .to_string();
            drop(tab_val);

            self.insert_tab(
                tab_id.clone(),
                serde_json::json!({
                    "layout": new_layout.clone(),
                    "active_pane_id": active_pane_id,
                }),
            );
            self.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: tab_id,
                layout: new_layout,
                active_pane_id,
            });
            None
        }
    }

    /// Registers the notifier once, so `kill_and_remove` and natural PTY/SSH exit paths can
    /// notify the attention ledger directly via `pane_closed_notify` without threading a
    /// notifier handle through every call site. Safe to call before `start_cleanup_task` (the
    /// two are independent - a bind failure or startup ordering issue must never suppress the
    /// detached-session reaper).
    pub fn register_notifier(&self, notifier: Arc<crate::notification::NotificationBroadcast>) {
        let _ = self.notifier.set(notifier);
    }

    pub fn start_cleanup_task(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            let reap_secs = parse_reap_secs(std::env::var("DINOTTY_DETACH_REAP_SECS").ok());
            let timeout = std::time::Duration::from_secs(reap_secs);
            loop {
                interval.tick().await;
                // Two-pass: collect stale IDs first, then kill_and_remove.
                // Can't use retain() because we need to kill child processes.
                let stale: Vec<String> = manager
                    .sessions
                    .iter()
                    .filter_map(|entry| {
                        let status = entry
                            .value()
                            .status
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        match *status {
                            SessionStatus::Detached { since } if since.elapsed() >= timeout => {
                                Some(entry.key().clone())
                            }
                            _ => None,
                        }
                    })
                    .collect();
                for pane_id in stale {
                    // Re-check status before killing - the session may have been
                    // reconnected between the collect pass and now.
                    let should_kill = manager.sessions.get(&pane_id).is_some_and(|entry| {
                        let status = entry.value().status.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                        matches!(*status, SessionStatus::Detached { since } if since.elapsed() >= timeout)
                    });

                    if should_kill {
                        info!("Cleanup: removing detached session: pane={}", pane_id);
                        // kill_and_remove now notifies the attention ledger internally.
                        manager.kill_and_remove(&pane_id);
                    }
                }
            }
        });
    }
}
