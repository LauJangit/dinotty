use crate::vt_screen::VirtualScreen;
use dashmap::DashMap;
use portable_pty::MasterPty;
use serde::Serialize;
use std::{
    io::Write,
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::mpsc;

pub enum SessionStatus {
    Connected,
    Detached { since: Instant },
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
}

impl Session {
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
