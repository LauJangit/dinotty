#![allow(clippy::unwrap_used, clippy::expect_used)]
use serde::Serialize;
use tokio::sync::broadcast;

/// Events published on the global event bus.
/// Clone is required for `broadcast::Sender`.
#[derive(Clone, Serialize, Debug)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum BusEvent {
    CommandFinished {
        pane_id: String,
        command: String,
        exit_code: i32,
        duration_ms: u64,
        stdout: String,
        method: String,
    },
    SessionCreated {
        pane_id: String,
        shell_type: String,
    },
    SessionClosed {
        pane_id: String,
        exit_code: Option<i32>,
    },
    TabCreated {
        tab_id: String,
        pane_id: String,
    },
    TabClosed {
        tab_id: String,
    },
    FileChanged {
        path: String,
        change_type: String,
    },
    Custom {
        plugin_id: String,
        event_name: String,
        data: serde_json::Value,
    },
}

/// Global event bus backed by `tokio::broadcast` channel.
/// Subscribers receive all events; they should filter by variant as needed.
#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<BusEvent>,
}

impl EventBus {
    #[must_use]
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self { sender }
    }

    /// Subscribe to all events. Returns a receiver that will get all future events.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<BusEvent> {
        self.sender.subscribe()
    }

    /// Publish an event to all subscribers. Silently drops if no receivers.
    pub fn publish(&self, event: BusEvent) {
        let _ = self.sender.send(event);
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_event_bus_publish_subscribe() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();

        bus.publish(BusEvent::SessionCreated {
            pane_id: "pane-1".into(),
            shell_type: "zsh".into(),
        });

        let event = rx.recv().await.unwrap();
        match event {
            BusEvent::SessionCreated { pane_id, shell_type } => {
                assert_eq!(pane_id, "pane-1");
                assert_eq!(shell_type, "zsh");
            }
            _ => panic!("unexpected event variant"),
        }
    }

    #[tokio::test]
    async fn test_event_bus_multiple_subscribers() {
        let bus = EventBus::new();
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();

        bus.publish(BusEvent::TabClosed { tab_id: "tab-1".into() });

        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();

        match (e1, e2) {
            (BusEvent::TabClosed { tab_id: t1 }, BusEvent::TabClosed { tab_id: t2 }) => {
                assert_eq!(t1, "tab-1");
                assert_eq!(t2, "tab-1");
            }
            _ => panic!("unexpected event variant"),
        }
    }

    #[tokio::test]
    async fn test_event_bus_no_subscribers() {
        let bus = EventBus::new();
        // Should not panic when no subscribers
        bus.publish(BusEvent::TabClosed { tab_id: "tab-1".into() });
    }

    #[tokio::test]
    async fn test_event_bus_serialization() {
        let event = BusEvent::CommandFinished {
            pane_id: "p1".into(),
            command: "ls -la".into(),
            exit_code: 0,
            duration_ms: 150,
            stdout: "file1.txt\n".into(),
            method: "shell_integration".into(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("command_finished"));
        assert!(json.contains("shell_integration"));
    }
}
