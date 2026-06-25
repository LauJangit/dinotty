#![allow(clippy::unwrap_used, clippy::expect_used)]
use serde::Serialize;
use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::error;

use crate::settings::config_dir;
use crate::util::chrono_now;

#[derive(Clone, Serialize, Debug)]
pub struct AuditEntry {
    pub ts: String,
    pub token_id: String,
    pub action: String,
    pub resource: String,
    pub details: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_id: Option<String>,
}

fn audit_path() -> PathBuf {
    config_dir().join("audit.log")
}

pub struct AuditLogger {
    tx: mpsc::UnboundedSender<AuditEntry>,
}

pub type AuditState = std::sync::Arc<AuditLogger>;

impl AuditLogger {
    #[must_use]
    pub fn new() -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<AuditEntry>();
        tokio::spawn(async move {
            while let Some(entry) = rx.recv().await {
                let path = audit_path();
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match serde_json::to_string(&entry) {
                    Ok(json) => {
                        use std::io::Write;
                        if let Ok(mut f) =
                            std::fs::OpenOptions::new().create(true).append(true).open(&path)
                        {
                            let _ = writeln!(f, "{json}");
                        }
                    }
                    Err(e) => error!("audit serialize: {}", e),
                }
            }
        });
        Self { tx }
    }

    pub fn log(&self, entry: AuditEntry) {
        let _ = self.tx.send(entry);
    }

    /// Helper to create and log an entry.
    pub fn record(&self, token_id: &str, action: &str, resource: &str, details: serde_json::Value) {
        self.log(AuditEntry {
            ts: chrono_now(),
            token_id: token_id.to_string(),
            action: action.to_string(),
            resource: resource.to_string(),
            details,
            audit_id: Some(uuid::Uuid::new_v4().to_string()),
        });
    }
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::new()
    }
}
