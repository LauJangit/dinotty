#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::unused_self,
    clippy::missing_errors_doc,
    clippy::unnecessary_wraps,
    clippy::match_same_arms,
    clippy::missing_panics_doc
)]
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

use crate::session::SessionManager;

pub struct McpResources {
    manager: Arc<SessionManager>,
}

#[derive(Serialize)]
pub struct ResourceDef {
    pub uri: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Serialize)]
pub struct ResourceTemplate {
    #[serde(rename = "uriTemplate")]
    pub uri_template: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

impl McpResources {
    pub fn new(manager: Arc<SessionManager>) -> Self {
        Self { manager }
    }

    #[must_use]
    pub fn list_resources(&self) -> Vec<ResourceDef> {
        vec![ResourceDef {
            uri: "terminal://sessions".into(),
            name: "Active Terminal Sessions".into(),
            description: "List of all active terminal sessions".into(),
            mime_type: "application/json".into(),
        }]
    }

    #[must_use]
    pub fn list_templates(&self) -> Vec<ResourceTemplate> {
        vec![
            ResourceTemplate {
                uri_template: "terminal://{pane_id}/screen".into(),
                name: "Terminal Screen Content".into(),
                description: "Current screen content of a terminal pane".into(),
                mime_type: "text/plain".into(),
            },
            ResourceTemplate {
                uri_template: "terminal://{pane_id}/scrollback".into(),
                name: "Terminal Scrollback History".into(),
                description: "Scrollback buffer of a terminal pane (last 1000 lines)".into(),
                mime_type: "text/plain".into(),
            },
        ]
    }

    pub fn read_resource(&self, uri: &str) -> Result<String, String> {
        if uri == "terminal://sessions" {
            let sessions: Vec<Value> = self
                .manager
                .sessions
                .iter()
                .map(|e| {
                    let pane_id = e.key();
                    let session = e.value();
                    let (cols, rows) = *session.size.lock().expect("mutex poisoned");
                    serde_json::json!({
                        "pane_id": pane_id,
                        "shell": session.shell_type,
                        "cols": cols,
                        "rows": rows,
                    })
                })
                .collect();
            return serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string());
        }

        // Match terminal://{pane_id}/screen
        if let Some(rest) = uri.strip_prefix("terminal://") {
            if let Some(pane_id) = rest.strip_suffix("/screen") {
                let session = self
                    .manager
                    .sessions
                    .get(pane_id)
                    .ok_or_else(|| format!("Pane not found: {pane_id}"))?;
                let screen = session.screen.lock().expect("mutex poisoned");
                return Ok(screen.snapshot_plain());
            }
            if let Some(pane_id) = rest.strip_suffix("/scrollback") {
                let session = self
                    .manager
                    .sessions
                    .get(pane_id)
                    .ok_or_else(|| format!("Pane not found: {pane_id}"))?;
                let screen = session.screen.lock().expect("mutex poisoned");
                let lines = screen.snapshot_scrollback_plain(Some(1000));
                return Ok(lines.join("\n"));
            }
        }

        Err(format!("Unknown resource: {uri}"))
    }
}
