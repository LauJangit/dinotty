use crate::vt_screen::VirtualScreen;
use dashmap::DashMap;
use portable_pty::{Child, MasterPty};
use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tracing::info;
use tokio::sync::mpsc;

pub enum SessionStatus {
    Connected,
    Detached { since: Instant },
}

pub struct CwdState {
    pub cwd: PathBuf,
    pub sniff_buf: Vec<u8>,
}

pub struct Session {
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
    pub screen: Mutex<VirtualScreen>,
    pub clients: Mutex<Vec<mpsc::UnboundedSender<String>>>,
    pub status: Mutex<SessionStatus>,
    pub size: Mutex<(u16, u16)>,
    #[allow(dead_code)]
    pub shell_type: String,
    pub tauri_on_exit: Mutex<Option<Arc<dyn Fn(String) + Send + Sync>>>,
    pub cwd_state: Mutex<CwdState>,
}

impl Session {
    pub fn on_pty_output(&self, data: &[u8]) {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let mut state = self.cwd_state.lock().unwrap();
        let CwdState { ref mut cwd, ref mut sniff_buf } = *state;
        sniff_cwd_from_title_osc(sniff_buf, data, &home, cwd);
    }

    pub fn add_client(&self) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.clients.lock().unwrap().push(tx);
        rx
    }

    pub fn broadcast(&self, msg: &str) {
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|tx| tx.send(msg.to_string()).is_ok());
    }

    pub fn has_clients(&self) -> bool {
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|tx| !tx.is_closed());
        !clients.is_empty()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap();
        let pid = child.process_id();
        let _ = child.kill();
        let _ = child.wait();
        info!("Session dropped, child reaped: pid={:?}", pid);
    }
}

const OSC_SNIFF_CAP: usize = 32768;

fn sniff_cwd_from_title_osc(buf: &mut Vec<u8>, chunk: &[u8], home: &Path, cwd: &mut PathBuf) {
    buf.extend_from_slice(chunk);
    if buf.len() > OSC_SNIFF_CAP {
        let drop = buf.len() - OSC_SNIFF_CAP;
        buf.drain(..drop);
    }
    let needle = b"\x1b]0;";
    loop {
        let Some(i) = find_subslice(buf, needle) else {
            break;
        };
        let payload_start = i + needle.len();
        let bel_pos = buf[payload_start..].iter().position(|&b| b == 0x07);
        let st_pos = buf[payload_start..].windows(2).position(|w| w == b"\x1b\\");
        let rel = match (bel_pos, st_pos) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        let terminator_len = if st_pos == Some(rel) { 2 } else { 1 };
        let title_end = payload_start + rel;
        let title = String::from_utf8_lossy(&buf[payload_start..title_end]);
        if let Some(p) = parse_title_cwd(&title, home) {
            if let Ok(c) = p.canonicalize() {
                *cwd = c;
            }
        }
        buf.drain(..title_end + terminator_len);
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn collect_leaf_pane_ids(layout: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    collect_leaf_ids_recursive(layout, &mut ids);
    ids
}

fn remove_pane_from_layout(node: &serde_json::Value, pane_id: &str) -> Option<serde_json::Value> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            if node.get("paneId")?.as_str()? == pane_id {
                None
            } else {
                Some(node.clone())
            }
        }
        "split" => {
            let children = node.get("children")?.as_array()?;
            let new_children: Vec<serde_json::Value> = children
                .iter()
                .filter_map(|c| remove_pane_from_layout(c, pane_id))
                .collect();
            match new_children.len() {
                0 => None,
                1 => Some(new_children.into_iter().next().unwrap()),
                _ => {
                    let mut result = node.clone();
                    result["children"] = serde_json::Value::Array(new_children);
                    // Rebalance ratios evenly
                    let n = result["children"].as_array().unwrap().len();
                    result["ratios"] = serde_json::Value::Array(
                        (0..n).map(|_| serde_json::Value::from(1.0 / n as f64)).collect()
                    );
                    Some(result)
                }
            }
        }
        _ => Some(node.clone()),
    }
}

fn collect_leaf_ids_recursive(node: &serde_json::Value, ids: &mut Vec<String>) {
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        if node_type == "leaf" {
            if let Some(pane_id) = node.get("paneId").and_then(|v| v.as_str()) {
                ids.push(pane_id.to_string());
            }
        } else if node_type == "split" {
            if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
                for child in children {
                    collect_leaf_ids_recursive(child, ids);
                }
            }
        }
    }
}

fn parse_title_cwd(title: &str, home: &Path) -> Option<PathBuf> {
    let at = title.rfind('@')?;
    let tail = title.get(at + 1..)?;
    let colon = tail.find(':')?;
    let path_part = tail.get(colon + 1..)?.trim();
    if path_part.is_empty() {
        return None;
    }
    let path = if let Some(rest) = path_part.strip_prefix("~/") {
        home.join(rest)
    } else if path_part == "~" {
        home.to_path_buf()
    } else if path_part.starts_with('/') {
        PathBuf::from(path_part)
    } else {
        home.join(path_part)
    };
    Some(path)
}

pub struct SessionManager {
    pub sessions: DashMap<String, Arc<Session>>,
    pub sync_clients: Arc<Mutex<Vec<mpsc::UnboundedSender<String>>>>,
    pub active_pane_id: Arc<Mutex<Option<String>>>,
    pub tab_layouts: DashMap<String, serde_json::Value>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMsg {
    TabList { tabs: Vec<TabInfo>, active_pane_id: Option<String> },
    TabCreated { pane_id: String },
    TabClosed { pane_id: String },
    TabActivated { pane_id: String },
    LayoutUpdated { pane_id: String, layout: serde_json::Value, active_pane_id: String },
    PluginChanged { plugin_id: String, change: String },
    ProcessExited { plugin_id: String, pid: u32, exit_code: Option<i32> },
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub pane_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_pane_id: Option<String>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            sync_clients: Arc::new(Mutex::new(Vec::new())),
            active_pane_id: Arc::new(Mutex::new(None)),
            tab_layouts: DashMap::new(),
        }
    }

    pub fn broadcast_sync(&self, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).unwrap();
        let mut clients = self.sync_clients.lock().unwrap();
        clients.retain(|tx| tx.send(json.clone()).is_ok());
    }

    pub fn add_sync_client(&self) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.sync_clients.lock().unwrap().push(tx);
        rx
    }

    pub fn broadcast_plugin_changed(&self, plugin_id: String, change: String) {
        self.broadcast_sync(&SyncMsg::PluginChanged { plugin_id, change });
    }

    /// Remove a pane_id from all parent tab layouts. If removing it causes
    /// a split to have only one child, the split collapses into that child.
    pub fn purge_pane_from_layouts(&self, pane_id: &str) {
        let updates: Vec<(String, serde_json::Value)> = self.tab_layouts.iter().filter_map(|entry| {
            let tab_pane_id = entry.key();
            if tab_pane_id == pane_id {
                return None;
            }
            let val = entry.value();
            let layout = val.get("layout")?;
            let new_layout = remove_pane_from_layout(layout, pane_id)?;
            if new_layout == *layout {
                return None;
            }
            let active = val.get("active_pane_id").cloned();
            let mut new_val = serde_json::json!({ "layout": new_layout });
            if let Some(a) = active {
                new_val["active_pane_id"] = a;
            }
            Some((tab_pane_id.clone(), new_val))
        }).collect();

        for (key, val) in updates {
            self.tab_layouts.insert(key, val);
        }
    }

    pub fn tab_list(&self) -> (Vec<TabInfo>, Option<String>) {
        // Collect stale tab layout keys (layouts whose leaf pane_ids no longer exist)
        let stale: Vec<String> = self.tab_layouts.iter().filter_map(|e| {
            let v = e.value();
            let layout = v.get("layout")?;
            let leaf_ids = collect_leaf_pane_ids(layout);
            if leaf_ids.is_empty() || !leaf_ids.iter().any(|id| self.sessions.contains_key(id)) {
                Some(e.key().clone())
            } else {
                None
            }
        }).collect();
        for key in stale {
            self.tab_layouts.remove(&key);
        }

        let mut tabs: Vec<TabInfo> = self.tab_layouts.iter().map(|e| {
            let v = e.value();
            let pane_id = e.key().clone();
            let layout = v.get("layout").cloned();
            let active_pane_id = v.get("active_pane_id").and_then(|v| v.as_str()).map(String::from);
            TabInfo { pane_id, layout, active_pane_id }
        }).collect();

        // Include sessions that don't belong to any existing tab (neither as tab id nor as a leaf)
        let leaf_ids: std::collections::HashSet<String> = tabs.iter()
            .filter_map(|t| t.layout.as_ref())
            .flat_map(|layout| collect_leaf_pane_ids(layout))
            .collect();
        for entry in self.sessions.iter() {
            let pane_id = entry.key().clone();
            if !tabs.iter().any(|t| t.pane_id == pane_id) && !leaf_ids.contains(&pane_id) {
                tabs.push(TabInfo { pane_id, layout: None, active_pane_id: None });
            }
        }

        let active = self.active_pane_id.lock().unwrap().clone();
        (tabs, active)
    }

    pub fn start_cleanup_task(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                let timeout = std::time::Duration::from_secs(300);
                manager.sessions.retain(|_, session| {
                    let status = session.status.lock().unwrap();
                    match *status {
                        SessionStatus::Detached { since } => since.elapsed() < timeout,
                        SessionStatus::Connected => true,
                    }
                });
            }
        });
    }
}
