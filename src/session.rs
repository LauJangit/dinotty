use crate::vt_screen::VirtualScreen;
use dashmap::DashMap;
use portable_pty::MasterPty;
use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
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
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMsg {
    TabList { tabs: Vec<TabInfo>, active_pane_id: Option<String> },
    TabCreated { pane_id: String },
    TabClosed { pane_id: String },
    TabActivated { pane_id: String },
    PluginChanged { plugin_id: String, change: String },
    ProcessExited { plugin_id: String, pid: u32, exit_code: Option<i32> },
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub pane_id: String,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            sync_clients: Arc::new(Mutex::new(Vec::new())),
            active_pane_id: Arc::new(Mutex::new(None)),
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

    pub fn tab_list(&self) -> (Vec<TabInfo>, Option<String>) {
        let tabs = self.sessions.iter().map(|e| TabInfo { pane_id: e.key().clone() }).collect();
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
