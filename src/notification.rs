use axum::{extract::State, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::broadcast;

use crate::{platform::shell, settings::SettingsState};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotificationEvent {
    Bell { pane_id: String },
    Notify { pane_id: String, title: Option<String>, body: String, notification_type: String },
}

pub struct NotificationBroadcast {
    tx: broadcast::Sender<NotificationEvent>,
    bell_debounce: Mutex<HashMap<String, Instant>>,
    debounce_ms: Mutex<u32>,
    settings: Mutex<Option<SettingsState>>,
}

impl Default for NotificationBroadcast {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationBroadcast {
    #[must_use]
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            tx,
            bell_debounce: Mutex::new(HashMap::new()),
            debounce_ms: Mutex::new(300),
            settings: Mutex::new(None),
        }
    }

    pub fn set_settings(&self, state: SettingsState) {
        *self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(state);
    }

    pub fn set_debounce_ms(&self, ms: u32) {
        *self.debounce_ms.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = ms;
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NotificationEvent> {
        self.tx.subscribe()
    }

    pub fn send_bell(&self, pane_id: &str) {
        let debounce_ms =
            *self.debounce_ms.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut map = self.bell_debounce.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = Instant::now();
        if let Some(last) = map.get(pane_id) {
            if now.duration_since(*last).as_millis() < u128::from(debounce_ms) {
                return;
            }
        }
        map.retain(|_, last| now.duration_since(*last).as_secs() < 60);
        map.insert(pane_id.to_string(), now);
        drop(map);
        let _ = self.tx.send(NotificationEvent::Bell { pane_id: pane_id.to_string() });
        self.run_hooks("bell", pane_id, None, "Bell");
    }

    pub fn send_notify(
        &self,
        pane_id: &str,
        title: Option<&str>,
        body: &str,
        notification_type: &str,
    ) {
        let _ = self.tx.send(NotificationEvent::Notify {
            pane_id: pane_id.to_string(),
            title: title.map(String::from),
            body: body.to_string(),
            notification_type: notification_type.to_string(),
        });
        self.run_hooks(notification_type, pane_id, title, body);
    }

    fn run_hooks(&self, notification_type: &str, pane_id: &str, title: Option<&str>, body: &str) {
        let hooks = {
            let guard = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(state) = guard.as_ref() else { return };
            let Ok(settings) = state.try_read() else { return };
            if !settings.notification.enabled {
                return;
            }
            settings.notification.hooks.clone()
        };

        for hook in hooks {
            if !hook.enabled || hook.command.is_empty() {
                continue;
            }
            if let Some(ref nt) = hook.notification_type {
                let nt_str =
                    serde_json::to_string(nt).unwrap_or_default().trim_matches('"').to_string();
                if nt_str != notification_type {
                    continue;
                }
            }
            let cmd = hook.command.clone();
            let env_type = notification_type.to_string();
            let env_pane = pane_id.to_string();
            let env_title = title.unwrap_or("").to_string();
            let env_body = body.to_string();

            tokio::spawn(async move {
                let hook_shell = shell::notification_hook_shell(&cmd);
                let mut command = tokio::process::Command::new(hook_shell.program);
                command.args(hook_shell.args);
                command
                    .env("DINOTTY_NOTIFICATION_TYPE", &env_type)
                    .env("DINOTTY_PANE_ID", &env_pane)
                    .env("DINOTTY_TITLE", &env_title)
                    .env("DINOTTY_BODY", &env_body);

                let result =
                    tokio::time::timeout(std::time::Duration::from_secs(30), command.output())
                        .await;
                match result {
                    Ok(Ok(output)) => {
                        if !output.status.success() {
                            tracing::warn!(
                                "Notification hook exited with {}: {}",
                                output.status,
                                String::from_utf8_lossy(&output.stderr)
                            );
                        }
                    }
                    Ok(Err(e)) => tracing::warn!("Notification hook failed: {e}"),
                    Err(_) => tracing::warn!("Notification hook timed out after 30s"),
                }
            });
        }
    }
}

#[derive(Deserialize)]
pub struct NotifyRequest {
    pub pane_id: Option<String>,
    pub title: Option<String>,
    pub body: String,
    #[serde(default = "default_notify_type")]
    pub notification_type: String,
}

fn default_notify_type() -> String {
    "info".to_string()
}

#[allow(clippy::unused_async)]
pub async fn post_notify(
    State(notifier): State<Arc<NotificationBroadcast>>,
    Json(req): Json<NotifyRequest>,
) -> impl IntoResponse {
    let pane_id = req.pane_id.unwrap_or_default();
    notifier.send_notify(&pane_id, req.title.as_deref(), &req.body, &req.notification_type);
    Json(serde_json::json!({ "ok": true }))
}
