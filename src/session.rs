use crate::vt_screen::VirtualScreen;
use dashmap::DashMap;
use portable_pty::MasterPty;
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
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub screen: Arc<Mutex<VirtualScreen>>,
    pub ws_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    pub status: Arc<Mutex<SessionStatus>>,
    pub size: Arc<Mutex<(u16, u16)>>,
    #[allow(dead_code)]
    pub shell_type: String,
}

pub struct SessionManager {
    pub sessions: DashMap<String, Arc<Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self { sessions: DashMap::new() }
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
