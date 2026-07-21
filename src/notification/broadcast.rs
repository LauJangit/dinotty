use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, watch};
use uuid::Uuid;

#[cfg(test)]
use crate::attention::StateDelta;
use crate::attention::{
    evaluate_ingest_gate, AttentionLedger, DedupOutcome, IngestGateResult, IngestSource,
    MarkReadResult, ProducerOutcome, ReserveResult, Severity,
};
use crate::platform::{process::CommandNoWindowExt, shell};
use crate::settings::{NotificationConfig, SettingsState};

use super::client::{ClientHandle, ClientRegistration, LedgerHub};
use super::protocol::ServerEnvelope;
use super::queue::{
    broadcast_data, enqueue_control, enqueue_data_direct, schedule_recovery_snapshot,
};
use super::types::{NotifyRequest, ProducerProcessResult};
use super::util::{conflict_mark_read, now_ms, payload_hash, severity_from_type};
use super::{ConnId, CONTROL_QUEUE_MSGS, MIN_PROTOCOL_VERSION};

pub struct NotificationBroadcast {
    pub(crate) hub: Mutex<LedgerHub>,
    next_conn_id: AtomicU64,
    bell_debounce: Mutex<HashMap<String, Instant>>,
    settings: Mutex<Option<SettingsState>>,
    /// Counts `run_hooks` invocations (not actual hook commands run - that additionally
    /// requires configured+enabled hooks). Lets tests assert the once-on-accept-only contract
    /// without spawning real OS processes.
    hook_invocations: AtomicU64,
}

impl Default for NotificationBroadcast {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationBroadcast {
    #[must_use]
    pub fn new() -> Self {
        Self {
            hub: Mutex::new(LedgerHub { ledger: AttentionLedger::new(), clients: HashMap::new() }),
            next_conn_id: AtomicU64::new(1),
            bell_debounce: Mutex::new(HashMap::new()),
            settings: Mutex::new(None),
            hook_invocations: AtomicU64::new(0),
        }
    }

    pub fn set_settings(&self, state: SettingsState) {
        *self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(state);
    }

    pub fn register_client(&self) -> ClientRegistration {
        let conn_id = self.next_conn_id.fetch_add(1, Ordering::Relaxed);
        // Capacity 1: the wake channel only needs to signal "there is data", never to carry one
        // token per queued message. A `Full` try_send is therefore a successful coalesce, not
        // backpressure - see `enqueue_data_direct`.
        let (data_wake_tx, data_wake) = mpsc::channel(1);
        let (control_tx, control) = mpsc::channel(CONTROL_QUEUE_MSGS);
        let (disconnect_tx, disconnect) = watch::channel(false);
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let snapshot = hub.ledger.snapshot();
        let mut client = ClientHandle {
            data: std::collections::VecDeque::new(),
            data_bytes: 0,
            data_wake: data_wake_tx,
            control: control_tx,
            disconnect: disconnect_tx,
            needs_snapshot: false,
            resync_enqueued: false,
            disconnect_requested: false,
        };
        enqueue_data_direct(&mut client, ServerEnvelope::Snapshot { snapshot });
        hub.clients.insert(conn_id, client);
        ClientRegistration { conn_id, data_wake, control, disconnect }
    }

    pub fn unregister_client(&self, conn_id: ConnId) {
        self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clients.remove(&conn_id);
    }

    pub fn take_data(&self, conn_id: ConnId) -> Option<ServerEnvelope> {
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let queued = hub.clients.get_mut(&conn_id)?.data.pop_front()?;
        let client = hub.clients.get_mut(&conn_id)?;
        client.data_bytes = client.data_bytes.saturating_sub(queued.bytes);
        schedule_recovery_snapshot(&mut hub, conn_id);
        Some(queued.envelope)
    }

    pub fn send_bell(&self, pane_id: &str) {
        let cfg = self.notification_config();
        let debounce_duplicate = {
            let mut map =
                self.bell_debounce.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let now = Instant::now();
            let duplicate = map.get(pane_id).is_some_and(|last| {
                now.duration_since(*last).as_millis() < u128::from(cfg.bell.debounce_ms)
            });
            map.retain(|_, last| now.duration_since(*last).as_secs() < 60);
            if !duplicate {
                map.insert(pane_id.to_string(), now);
            }
            duplicate
        };
        if !matches!(
            evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate }),
            IngestGateResult::Accepted
        ) {
            return;
        }

        let occurred_at = now_ms();
        {
            let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let (event_seq, delta) =
                hub.ledger.record_pane_event(pane_id, occurred_at, Severity::Info, occurred_at);
            broadcast_data(
                &mut hub,
                ServerEnvelope::StateDelta { delta },
                Some(ServerEnvelope::Bell {
                    v: MIN_PROTOCOL_VERSION,
                    pane_id: pane_id.to_string(),
                    title: None,
                    body: "Bell".into(),
                    notification_type: "bell".into(),
                    event_seq: event_seq.to_string(),
                    occurred_at,
                    severity: Severity::Info,
                    notif_id: None,
                }),
            );
        }
        self.run_hooks("bell", pane_id, None, "Bell");
    }

    pub fn send_notify(
        &self,
        pane_id: &str,
        title: Option<&str>,
        body: &str,
        notification_type: &str,
    ) {
        let cfg = self.notification_config();
        if !matches!(
            evaluate_ingest_gate(&cfg, IngestSource::OscNotify),
            IngestGateResult::Accepted
        ) {
            return;
        }
        let severity = severity_from_type(notification_type).unwrap_or(Severity::Info);
        let occurred_at = now_ms();
        {
            let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let (event_seq, delta) =
                hub.ledger.record_pane_event(pane_id, occurred_at, severity, occurred_at);
            broadcast_data(
                &mut hub,
                ServerEnvelope::StateDelta { delta },
                Some(ServerEnvelope::Notify {
                    v: MIN_PROTOCOL_VERSION,
                    pane_id: pane_id.to_string(),
                    title: title.map(String::from),
                    body: body.to_string(),
                    notification_type: notification_type.to_string(),
                    event_seq: event_seq.to_string(),
                    occurred_at,
                    severity,
                    notif_id: None,
                }),
            );
        }
        self.run_hooks(notification_type, pane_id, title, body);
    }

    pub fn apply_mark_read(&self, conn_id: ConnId, request: &super::types::MarkReadRequest) {
        let now = now_ms();
        let payload_hash = payload_hash(&("notification.mark_read", request));
        let key = (request.client_id.clone(), request.request_id.clone());
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let outcome = match hub.ledger.reserve(&key.0, &key.1, payload_hash, now) {
            ReserveResult::Replay(DedupOutcome::MarkRead(result)) => {
                enqueue_control(&mut hub, conn_id, ServerEnvelope::MarkReadResult { result });
                return;
            }
            ReserveResult::InFlight => {
                // Only reachable during a zombie RESERVATION_TIMEOUT window under the
                // synchronous critical section. Per design C3-03, an in-flight duplicate must
                // NOT get a conflict verdict (that would make the client drop its overlay) - send
                // no reply at all; the client's own ack-timeout resend will later hit either
                // Done(replay) or a reclaimed key (fresh apply).
                tracing::debug!(
                    "mark_read reservation in-flight for {:?}; suppressing reply, awaiting resend",
                    key
                );
                return;
            }
            ReserveResult::Replay(_) | ReserveResult::Conflict => {
                conflict_mark_read(request, hub.ledger.epoch())
            }
            ReserveResult::Reserved { generation } => {
                let panes: Vec<_> = request
                    .panes
                    .iter()
                    .filter_map(|pane| {
                        pane.through_event_seq
                            .parse::<u64>()
                            .ok()
                            .map(|seq| (pane.pane_id.clone(), seq))
                    })
                    .collect();
                let notifs: Vec<_> =
                    request.notifs.iter().map(|notif| notif.notif_id.clone()).collect();
                let (delta, results, applied_at_revision) =
                    hub.ledger.mark_read(&request.epoch, &panes, &notifs, now);
                let result = MarkReadResult {
                    request_id: request.request_id.clone(),
                    epoch: hub.ledger.epoch().to_string(),
                    applied_at_revision,
                    results,
                };
                let installed = hub.ledger.complete(
                    &key,
                    generation,
                    DedupOutcome::MarkRead(result.clone()),
                    now,
                );
                debug_assert!(installed);
                if let Some(delta) = delta {
                    broadcast_data(&mut hub, ServerEnvelope::StateDelta { delta }, None);
                }
                result
            }
        };
        enqueue_control(&mut hub, conn_id, ServerEnvelope::MarkReadResult { result: outcome });
    }

    pub fn sweep(&self, now: u64) {
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(delta) = hub.ledger.sweep(now) {
            broadcast_data(&mut hub, ServerEnvelope::StateDelta { delta }, None);
        }
    }

    /// Notifies the ledger that a pane was authoritatively removed (tab/pane close, or the
    /// detached-session reaper), broadcasting the resulting removal delta if the pane had any
    /// attention state. Safe to call for a pane the ledger never tracked (no-op).
    pub fn pane_closed(&self, pane_id: &str) {
        let now = now_ms();
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(delta) = hub.ledger.pane_closed(pane_id, now) {
            broadcast_data(&mut hub, ServerEnvelope::StateDelta { delta }, None);
        }
    }

    fn notification_config(&self) -> NotificationConfig {
        let guard = self.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        guard
            .as_ref()
            .and_then(|state| state.try_read().ok().map(|settings| settings.notification.clone()))
            .unwrap_or_default()
    }

    pub(crate) fn process_notify<F>(
        &self,
        req: NotifyRequest,
        pane_is_live: F,
    ) -> ProducerProcessResult
    where
        F: FnOnce(&str) -> bool,
    {
        let severity = match severity_from_type(&req.notification_type) {
            Some(severity) => severity,
            None => return ProducerProcessResult::Malformed("invalid notification type".into()),
        };
        if req.source.as_deref().is_some_and(|source| source != "plugin") {
            return ProducerProcessResult::Malformed("invalid source".into());
        }
        let cfg = self.notification_config();
        if cfg.enabled && req.category.as_deref() == Some("idle_reminder") && !cfg.idle_reminder {
            return ProducerProcessResult::Outcome(ProducerOutcome::Suppressed {
                reason: "idle_reminder_disabled".into(),
            });
        }
        if req.client_id.is_some() != req.request_id.is_some() {
            return ProducerProcessResult::Malformed(
                "clientId and requestId must be provided together".into(),
            );
        }
        let pane_id = req.pane_id.as_deref().filter(|id| !id.is_empty()).map(str::to_owned);
        if pane_id.as_ref().is_some_and(|id| Uuid::parse_str(id).is_err()) {
            return ProducerProcessResult::Malformed("invalid paneId".into());
        }

        let client_id = req.client_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        let request_id = req.request_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        if client_id.is_empty() || request_id.is_empty() {
            return ProducerProcessResult::Malformed("clientId/requestId must not be empty".into());
        }
        let payload_hash = payload_hash(&("producer.notify", &req));
        let key = (client_id.clone(), request_id.clone());
        let now = now_ms();
        let mut pane_is_live = Some(pane_is_live);
        // Hooks (spec §10) must fire exactly once, ONLY on a newly-accepted event - never on
        // suppressed/not_found/replay/conflict - and must run AFTER the hub lock is released
        // (run_hooks takes the settings lock and spawns processes; it must not run under the
        // hub mutex). Stash what to call here; fire it once the guard below is dropped.
        let mut accepted_hook: Option<(String, String, Option<String>, String)> = None;
        let result = {
            let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            match hub.ledger.reserve(&client_id, &request_id, payload_hash, now) {
                ReserveResult::Replay(DedupOutcome::Producer(outcome)) => {
                    ProducerProcessResult::Outcome(outcome)
                }
                ReserveResult::Replay(_) | ReserveResult::Conflict => {
                    ProducerProcessResult::Conflict
                }
                // Only reachable during a zombie RESERVATION_TIMEOUT window under the synchronous
                // critical section. Per design C3-03 this must not be treated as a payload
                // conflict - it is retryable, not a genuine same-key-different-payload collision.
                ReserveResult::InFlight => ProducerProcessResult::Retry,
                ReserveResult::Reserved { generation } => {
                    let outcome = match evaluate_ingest_gate(&cfg, IngestSource::Plugin) {
                        IngestGateResult::Suppressed(reason) => {
                            ProducerOutcome::Suppressed { reason }
                        }
                        IngestGateResult::Accepted => {
                            if let Some(ref pane_id) = pane_id {
                                if !(pane_is_live.take().expect("liveness closure used once"))(
                                    pane_id,
                                ) {
                                    ProducerOutcome::NotFound
                                } else {
                                    let (event_seq, delta) =
                                        hub.ledger.record_pane_event(pane_id, now, severity, now);
                                    let revision = delta.revision;
                                    broadcast_data(
                                        &mut hub,
                                        ServerEnvelope::StateDelta { delta },
                                        Some(ServerEnvelope::Notify {
                                            v: MIN_PROTOCOL_VERSION,
                                            pane_id: pane_id.clone(),
                                            title: req.title.clone(),
                                            body: req.body.clone(),
                                            notification_type: req.notification_type.clone(),
                                            event_seq: event_seq.to_string(),
                                            occurred_at: now,
                                            severity,
                                            notif_id: None,
                                        }),
                                    );
                                    accepted_hook = Some((
                                        req.notification_type.clone(),
                                        pane_id.clone(),
                                        req.title.clone(),
                                        req.body.clone(),
                                    ));
                                    ProducerOutcome::AcceptedPane {
                                        pane_id: pane_id.clone(),
                                        event_seq,
                                        revision,
                                    }
                                }
                            } else {
                                let notif_id = Uuid::new_v4().to_string();
                                let (event_seq, delta) =
                                    hub.ledger.record_notif_event(&notif_id, now, severity, now);
                                let revision = delta.revision;
                                broadcast_data(
                                    &mut hub,
                                    ServerEnvelope::StateDelta { delta },
                                    Some(ServerEnvelope::Notify {
                                        v: MIN_PROTOCOL_VERSION,
                                        pane_id: String::new(),
                                        title: req.title.clone(),
                                        body: req.body.clone(),
                                        notification_type: req.notification_type.clone(),
                                        event_seq: event_seq.to_string(),
                                        occurred_at: now,
                                        severity,
                                        notif_id: Some(notif_id.clone()),
                                    }),
                                );
                                accepted_hook = Some((
                                    req.notification_type.clone(),
                                    String::new(),
                                    req.title.clone(),
                                    req.body.clone(),
                                ));
                                ProducerOutcome::AcceptedNotif { notif_id, event_seq, revision }
                            }
                        }
                    };
                    let installed = hub.ledger.complete(
                        &key,
                        generation,
                        DedupOutcome::Producer(outcome.clone()),
                        now,
                    );
                    debug_assert!(installed);
                    ProducerProcessResult::Outcome(outcome)
                }
            }
        };
        if let Some((notification_type, pane_id, title, body)) = accepted_hook {
            self.run_hooks(&notification_type, &pane_id, title.as_deref(), &body);
        }
        result
    }

    fn run_hooks(&self, notification_type: &str, pane_id: &str, title: Option<&str>, body: &str) {
        self.hook_invocations.fetch_add(1, Ordering::Relaxed);
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
                command.no_window().args(hook_shell.args);
                command
                    .env("DINOTTY_NOTIFICATION_TYPE", &env_type)
                    .env("DINOTTY_PANE_ID", &env_pane)
                    .env("DINOTTY_TITLE", &env_title)
                    .env("DINOTTY_BODY", &env_body);

                let result = tokio::time::timeout(Duration::from_secs(30), command.output()).await;
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

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> crate::attention::Snapshot {
        self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner).ledger.snapshot()
    }

    #[cfg(test)]
    pub(crate) fn broadcast_test_delta(&self, pane_id: &str, now: u64) -> StateDelta {
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let (_, delta) = hub.ledger.record_pane_event(pane_id, now, Severity::Info, now);
        broadcast_data(&mut hub, ServerEnvelope::StateDelta { delta: delta.clone() }, None);
        delta
    }

    #[cfg(test)]
    pub(crate) fn fill_control_for_test(&self, conn_id: ConnId) {
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for _ in 0..=CONTROL_QUEUE_MSGS {
            enqueue_control(&mut hub, conn_id, ServerEnvelope::ResyncRequired { v: 1 });
        }
    }

    #[cfg(test)]
    pub(crate) fn client_disconnect_requested(&self, conn_id: ConnId) -> bool {
        self.hub
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clients
            .get(&conn_id)
            .is_none_or(|client| client.disconnect_requested)
    }

    #[cfg(test)]
    pub(crate) fn hook_invocation_count(&self) -> u64 {
        self.hook_invocations.load(Ordering::Relaxed)
    }
}
