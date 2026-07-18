#![allow(
    clippy::duration_suboptimal_units,
    clippy::expect_used,
    clippy::if_not_else,
    clippy::manual_let_else,
    clippy::must_use_candidate,
    clippy::needless_pass_by_value,
    clippy::too_many_lines,
    clippy::unused_async
)]

use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

use crate::{
    attention::{
        evaluate_ingest_gate, AttentionLedger, DedupOutcome, IngestGateResult, IngestSource,
        MarkReadResult, ProducerOutcome, ReserveResult, Severity, Snapshot, StateDelta,
        TargetResult, TargetStatus,
    },
    platform::{process::CommandNoWindowExt, shell},
    session::SessionManager,
    settings::{NotificationConfig, SettingsState},
};

/// Notification WebSocket protocol and queue limits. Data uses a bounded wakeup lane plus the
/// mutex-owned FIFO so overflowing clients can selectively discard state deltas. Control messages
/// are independently bounded and are never silently dropped.
pub const MIN_PROTOCOL_VERSION: u64 = 1;
pub const CLOSE_UPGRADE_REQUIRED: u16 = 4001;
pub const DATA_QUEUE_MSGS: usize = 256;
pub const DATA_QUEUE_BYTES: usize = 1024 * 1024;
pub const CONTROL_QUEUE_MSGS: usize = 64;
pub const DRAIN_STALL_MS: u64 = 10_000;
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

pub type ConnId = u64;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEnvelope {
    // These two variants intentionally retain the legacy `type:"bell"|"notify"` shape. The
    // protocol-v1 dispatcher recognizes the added `v` and authoritative identity fields first.
    Bell {
        v: u64,
        pane_id: String,
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
    // Epoch is deliberately carried inside Snapshot/StateDelta instead of a separate envelope.
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
}

impl ServerEnvelope {
    fn is_state_delta(&self) -> bool {
        matches!(self, Self::StateDelta { .. })
    }

    pub fn revision(&self) -> Option<u64> {
        match self {
            Self::StateDelta { delta } => Some(delta.revision),
            Self::Snapshot { snapshot } => Some(snapshot.revision),
            _ => None,
        }
    }
}

#[derive(Debug)]
struct QueuedData {
    envelope: ServerEnvelope,
    bytes: usize,
}

#[derive(Debug)]
struct ClientHandle {
    data: VecDeque<QueuedData>,
    data_bytes: usize,
    data_wake: mpsc::Sender<()>,
    control: mpsc::Sender<ServerEnvelope>,
    disconnect: watch::Sender<bool>,
    needs_snapshot: bool,
    resync_enqueued: bool,
    disconnect_requested: bool,
}

#[derive(Debug)]
pub struct ClientRegistration {
    pub conn_id: ConnId,
    pub data_wake: mpsc::Receiver<()>,
    pub control: mpsc::Receiver<ServerEnvelope>,
    pub disconnect: watch::Receiver<bool>,
}

#[derive(Debug)]
struct LedgerHub {
    ledger: AttentionLedger,
    clients: HashMap<ConnId, ClientHandle>,
}

pub struct NotificationBroadcast {
    hub: Mutex<LedgerHub>,
    next_conn_id: AtomicU64,
    bell_debounce: Mutex<HashMap<String, Instant>>,
    settings: Mutex<Option<SettingsState>>,
    /// Counts `run_hooks` invocations (not actual hook commands run — that additionally
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
        // backpressure — see `enqueue_data_direct`.
        let (data_wake_tx, data_wake) = mpsc::channel(1);
        let (control_tx, control) = mpsc::channel(CONTROL_QUEUE_MSGS);
        let (disconnect_tx, disconnect) = watch::channel(false);
        let mut hub = self.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let snapshot = hub.ledger.snapshot();
        let mut client = ClientHandle {
            data: VecDeque::new(),
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

    pub fn apply_mark_read(&self, conn_id: ConnId, request: &MarkReadRequest) {
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
                // NOT get a conflict verdict (that would make the client drop its overlay) — send
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

    fn process_notify<F>(&self, req: NotifyRequest, pane_is_live: F) -> ProducerProcessResult
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
        // Hooks (spec §10) must fire exactly once, ONLY on a newly-accepted event — never on
        // suppressed/not_found/replay/conflict — and must run AFTER the hub lock is released
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
                // conflict — it is retryable, not a genuine same-key-different-payload collision.
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
    pub(crate) fn snapshot(&self) -> Snapshot {
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

fn broadcast_data(hub: &mut LedgerHub, first: ServerEnvelope, second: Option<ServerEnvelope>) {
    let ids: Vec<_> = hub.clients.keys().copied().collect();
    for conn_id in ids {
        enqueue_data(hub, conn_id, first.clone());
        if let Some(second) = &second {
            enqueue_data(hub, conn_id, second.clone());
        }
    }
}

fn enqueue_data(hub: &mut LedgerHub, conn_id: ConnId, envelope: ServerEnvelope) {
    let Some(client) = hub.clients.get_mut(&conn_id) else { return };
    if client.disconnect_requested {
        return;
    }
    if client.needs_snapshot && envelope.is_state_delta() {
        return;
    }
    let bytes = serialized_len(&envelope);
    if client.data.len() >= DATA_QUEUE_MSGS
        || client.data_bytes.saturating_add(bytes) > DATA_QUEUE_BYTES
    {
        drop_queued_deltas(client);
        client.needs_snapshot = true;
        if !client.resync_enqueued {
            client.resync_enqueued = true;
            // Deviation from design §5 control-lane membership, ordering-driven: resync_required
            // travels the DATA lane (not control) so the single FIFO guarantees it arrives
            // strictly before the recovery snapshot enqueued just below. If resync instead rode
            // the control lane, the writer's data-drain loop could deliver the snapshot first,
            // and the client would adopt authoritative state before ever entering
            // awaiting_snapshot — silently discarding every future delta. drop_queued_deltas just
            // freed capacity, so this always fits; only StateDelta envelopes are ever dropped.
            enqueue_data_direct(client, ServerEnvelope::ResyncRequired { v: MIN_PROTOCOL_VERSION });
        }
        schedule_recovery_snapshot(hub, conn_id);
        if envelope.is_state_delta() {
            return;
        }
    }
    let Some(client) = hub.clients.get_mut(&conn_id) else { return };
    if client.data.len() < DATA_QUEUE_MSGS
        && client.data_bytes.saturating_add(bytes) <= DATA_QUEUE_BYTES
    {
        enqueue_data_direct(client, envelope);
    }
}

fn enqueue_data_direct(client: &mut ClientHandle, envelope: ServerEnvelope) {
    let bytes = serialized_len(&envelope);
    if bytes > DATA_QUEUE_BYTES {
        // Cannot ever fit, even against an empty queue.
        request_disconnect(client);
        return;
    }
    // A `Full` wake token means a wake is already pending for the writer to drain the queue —
    // that is coalescing working as intended, not backpressure. Only a closed channel (the
    // writer/reader half dropped) means the peer is actually gone.
    match client.data_wake.try_send(()) {
        Ok(()) | Err(mpsc::error::TrySendError::Full(())) => {}
        Err(mpsc::error::TrySendError::Closed(())) => {
            request_disconnect(client);
            return;
        }
    }
    // The aggregate bound (DATA_QUEUE_MSGS / DATA_QUEUE_BYTES) is a hard invariant for EVERY
    // insert path here, not just the ordinary delta fast-path — a queue full of non-droppable
    // envelopes (raised Bell/Notify cues, a stale Snapshot) must not let resync_required/the
    // recovery snapshot push it over the limit. Evict the OLDEST entries until there's room:
    // raised cues are expendable presentation (design §13 accepts card-body gaps) and a queued
    // stale Snapshot is superseded by whichever snapshot follows. ResyncRequired is EXEMPT from
    // eviction: frames are small, and each overflow cycle adds at most one before its recovery
    // snapshot clears resync_enqueued (so multiple resync frames CAN coexist across separate
    // overflow cycles, but their aggregate stays negligible) — losing one would leave the client
    // with no signal that a resync happened before it eventually adopts a snapshot. Evicting the
    // oldest non-resync entry instead also preserves the resync-before-snapshot relative order
    // (the snapshot itself is appended strictly after, in a later call), and a non-resync entry is
    // always available to evict since resync frames alone cannot fill the whole bound.
    while client.data.len() >= DATA_QUEUE_MSGS
        || client.data_bytes.saturating_add(bytes) > DATA_QUEUE_BYTES
    {
        let evict_at = client
            .data
            .iter()
            .position(|queued| !matches!(queued.envelope, ServerEnvelope::ResyncRequired { .. }));
        let Some(idx) = evict_at else { break };
        let evicted = client.data.remove(idx).expect("index from position() is valid");
        client.data_bytes = client.data_bytes.saturating_sub(evicted.bytes);
    }
    client.data.push_back(QueuedData { envelope, bytes });
    client.data_bytes += bytes;
    debug_assert!(client.data.len() <= DATA_QUEUE_MSGS, "data queue exceeded message bound");
    debug_assert!(client.data_bytes <= DATA_QUEUE_BYTES, "data queue exceeded byte bound");
}

fn drop_queued_deltas(client: &mut ClientHandle) {
    client.data.retain(|queued| {
        if queued.envelope.is_state_delta() {
            client.data_bytes = client.data_bytes.saturating_sub(queued.bytes);
            false
        } else {
            true
        }
    });
}

fn schedule_recovery_snapshot(hub: &mut LedgerHub, conn_id: ConnId) {
    let snapshot = hub.ledger.snapshot();
    let envelope = ServerEnvelope::Snapshot { snapshot };
    let bytes = serialized_len(&envelope);
    let Some(client) = hub.clients.get_mut(&conn_id) else { return };
    if !client.needs_snapshot || client.disconnect_requested {
        return;
    }
    if client.data.len() < DATA_QUEUE_MSGS
        && client.data_bytes.saturating_add(bytes) <= DATA_QUEUE_BYTES
    {
        enqueue_data_direct(client, envelope);
        client.needs_snapshot = false;
        client.resync_enqueued = false;
    }
}

fn enqueue_control(hub: &mut LedgerHub, conn_id: ConnId, envelope: ServerEnvelope) {
    let Some(client) = hub.clients.get_mut(&conn_id) else { return };
    if client.disconnect_requested {
        return;
    }
    if client.control.try_send(envelope).is_err() {
        request_disconnect(client);
    }
}

fn request_disconnect(client: &mut ClientHandle) {
    client.disconnect_requested = true;
    let _ = client.disconnect.send(true);
}

fn serialized_len(envelope: &ServerEnvelope) -> usize {
    serde_json::to_vec(envelope).map_or(DATA_QUEUE_BYTES + 1, |json| json.len())
}

fn conflict_mark_read(request: &MarkReadRequest, epoch: &str) -> MarkReadResult {
    let results = request
        .panes
        .iter()
        .map(|pane| TargetResult {
            target: crate::attention::AttentionTarget::Pane { pane_id: pane.pane_id.clone() },
            status: TargetStatus::Conflict,
        })
        .chain(request.notifs.iter().map(|notif| TargetResult {
            target: crate::attention::AttentionTarget::Notif { notif_id: notif.notif_id.clone() },
            status: TargetStatus::Conflict,
        }))
        .collect();
    MarkReadResult {
        request_id: request.request_id.clone(),
        epoch: epoch.to_string(),
        applied_at_revision: None,
        results,
    }
}

fn payload_hash<T: Serialize>(payload: &T) -> u64 {
    let mut hasher = DefaultHasher::new();
    serde_json::to_vec(payload).unwrap_or_default().hash(&mut hasher);
    hasher.finish()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn severity_from_type(value: &str) -> Option<Severity> {
    match value {
        "info" | "bell" => Some(Severity::Info),
        "success" => Some(Severity::Success),
        "warning" => Some(Severity::Warning),
        "error" => Some(Severity::Error),
        "urgent" => Some(Severity::Urgent),
        _ => None,
    }
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadRequest {
    pub v: u64,
    pub epoch: String,
    pub client_id: String,
    pub request_id: String,
    pub reason: MarkReadReason,
    #[serde(default)]
    pub panes: Vec<MarkReadPane>,
    #[serde(default)]
    pub notifs: Vec<MarkReadNotif>,
}

#[derive(Clone, Copy, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkReadReason {
    Focus,
    TerminalInput,
    TabActivate,
    TabClose,
    PaneClose,
    Goto,
    ActiveObserved,
    Dismiss,
    ClearAll,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadPane {
    pub pane_id: String,
    pub through_event_seq: String,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadNotif {
    pub notif_id: String,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyRequest {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    // camelCase's own name for this field is "paneId"; documented legacy callers
    // (docs/notifications.en.md, scripts/notify-done.sh, users' Claude Code hooks) send the
    // original snake_case "pane_id" — accept both.
    #[serde(default, alias = "pane_id")]
    pub pane_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub body: String,
    // Legacy callers send snake_case "notification_type"; some send the shorter "type".
    #[serde(default = "default_notify_type", alias = "type", alias = "notification_type")]
    pub notification_type: String,
}

fn default_notify_type() -> String {
    "info".to_string()
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ProducerProcessResult {
    Outcome(ProducerOutcome),
    Conflict,
    /// Reservation is in-flight under a zombie window; the caller should retry, not treat this
    /// as a payload conflict.
    Retry,
    Malformed(String),
}

pub async fn post_notify(
    State((notifier, manager)): State<(Arc<NotificationBroadcast>, Arc<SessionManager>)>,
    payload: Result<Json<NotifyRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(req)) = payload else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "malformed" })))
            .into_response();
    };
    match notifier.process_notify(req, |pane_id| {
        manager.is_pane_in_any_tab(pane_id) && manager.sessions.contains_key(pane_id)
    }) {
        ProducerProcessResult::Outcome(outcome) => producer_response(outcome),
        ProducerProcessResult::Conflict => {
            (StatusCode::CONFLICT, Json(serde_json::json!({ "status": "conflict" })))
                .into_response()
        }
        ProducerProcessResult::Retry => {
            (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "status": "retry" })))
                .into_response()
        }
        ProducerProcessResult::Malformed(error) => {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": error }))).into_response()
        }
    }
}

fn producer_response(outcome: ProducerOutcome) -> Response {
    match outcome {
        ProducerOutcome::AcceptedPane { pane_id, event_seq, revision } => (
            StatusCode::OK,
            Json(serde_json::json!({
                "paneId": pane_id,
                "eventSeq": event_seq.to_string(),
                "revision": revision.to_string()
            })),
        )
            .into_response(),
        ProducerOutcome::AcceptedNotif { notif_id, event_seq, revision } => (
            StatusCode::OK,
            Json(serde_json::json!({
                "notifId": notif_id,
                "eventSeq": event_seq.to_string(),
                "revision": revision.to_string()
            })),
        )
            .into_response(),
        ProducerOutcome::Suppressed { reason } => {
            (StatusCode::OK, Json(serde_json::json!({ "status": "suppressed", "reason": reason })))
                .into_response()
        }
        ProducerOutcome::NotFound => {
            (StatusCode::NOT_FOUND, Json(serde_json::json!({ "status": "not_found" })))
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use std::cell::Cell;
    use tokio::sync::mpsc::error::TryRecvError;

    fn notify_request(
        client_id: Option<&str>,
        request_id: Option<&str>,
        pane_id: Option<&str>,
    ) -> NotifyRequest {
        NotifyRequest {
            client_id: client_id.map(str::to_string),
            request_id: request_id.map(str::to_string),
            source: Some("plugin".into()),
            category: None,
            pane_id: pane_id.map(str::to_string),
            title: Some("Test".into()),
            body: "Body".into(),
            notification_type: "info".into(),
        }
    }

    fn pane_seq(snapshot: &Snapshot, pane_id: &str) -> u64 {
        snapshot
            .panes
            .iter()
            .find(|pane| pane.pane_id == pane_id)
            .and_then(|pane| pane.latest_event_seq)
            .expect("pane must have a latest event")
    }

    fn mark_read_request(
        snapshot: &Snapshot,
        request_id: &str,
        panes: &[&str],
        notifs: &[&str],
    ) -> MarkReadRequest {
        MarkReadRequest {
            v: MIN_PROTOCOL_VERSION,
            epoch: snapshot.epoch.clone(),
            client_id: "reader-client".into(),
            request_id: request_id.into(),
            reason: MarkReadReason::Dismiss,
            panes: panes
                .iter()
                .map(|pane_id| MarkReadPane {
                    pane_id: (*pane_id).into(),
                    through_event_seq: pane_seq(snapshot, pane_id).to_string(),
                })
                .collect(),
            notifs: notifs
                .iter()
                .map(|notif_id| MarkReadNotif { notif_id: (*notif_id).into() })
                .collect(),
        }
    }

    fn accepted_notif_id(result: ProducerProcessResult) -> String {
        match result {
            ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { notif_id, .. }) => {
                notif_id
            }
            other => panic!("expected accepted pane-less notification, got {other:?}"),
        }
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn data_overflow_emits_resync_before_recovery_snapshot_on_data_lane() {
        let notifier = NotificationBroadcast::new();
        let mut registration = notifier.register_client();
        registration.data_wake.try_recv().unwrap();
        assert!(matches!(
            notifier.take_data(registration.conn_id),
            Some(ServerEnvelope::Snapshot { .. })
        ));

        // Moderate-size deltas (small enough that the recovery snapshot itself still fits under
        // the byte cap) accumulate in the queue until the byte cap trips. Stop broadcasting the
        // instant it does: the recovery snapshot is enqueued (and flags cleared) in the SAME
        // call that trips it, so a later iteration would just queue normally again and this test
        // would observe a second overflow cycle instead of the first one.
        let pane_id = "p".repeat(32 * 1024);
        let queue_len = |notifier: &NotificationBroadcast| {
            notifier
                .hub
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clients
                .get(&registration.conn_id)
                .map_or(0, |client| client.data.len())
        };
        let mut previous_len = 0usize;
        for i in 0..DATA_QUEUE_MSGS {
            notifier.broadcast_test_delta(&pane_id, i as u64);
            let current_len = queue_len(&notifier);
            // Normal accumulation grows the queue by exactly one message per call. A
            // drop-then-requeue cycle (overflow) instead resets it down to two (resync +
            // recovery snapshot) — detect that transition and stop right there.
            if current_len <= previous_len {
                break;
            }
            previous_len = current_len;
        }

        assert!(!notifier.client_disconnect_requested(registration.conn_id));
        // resync_required now travels the DATA lane exclusively; control carries only
        // mark_read_result.
        assert!(matches!(registration.control.try_recv(), Err(TryRecvError::Empty)));

        // FIFO ordering: resync_required MUST precede the recovery snapshot on the single data
        // queue, so a client never adopts authoritative state before it knows a resync happened.
        // (The queued snapshot was captured at overflow time; the ledger's live revision has
        // since kept advancing from further broadcasts the client never saw, so only the
        // envelope ORDER is asserted here, not equality with the current live snapshot.)
        match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::ResyncRequired { v: MIN_PROTOCOL_VERSION }) => {}
            other => panic!("expected resync_required first, got {other:?}"),
        }
        match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::Snapshot { .. }) => {}
            other => panic!("expected recovery snapshot after resync, got {other:?}"),
        }
        assert!(notifier.take_data(registration.conn_id).is_none());
    }

    #[test]
    fn overflow_with_non_droppable_heavy_queue_still_respects_the_bound() {
        // A queue full of NON-droppable envelopes (here: raised Notify cues) must never let
        // resync_required + the recovery snapshot push it past the aggregate bound —
        // drop_queued_deltas alone cannot reclaim anything here, since there are no StateDelta
        // entries to drop.
        let notifier = NotificationBroadcast::new();
        let registration = notifier.register_client();
        notifier.take_data(registration.conn_id).unwrap(); // snapshot

        {
            let mut hub = notifier.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let client = hub.clients.get_mut(&registration.conn_id).unwrap();
            for i in 0..DATA_QUEUE_MSGS {
                let envelope = ServerEnvelope::Notify {
                    v: MIN_PROTOCOL_VERSION,
                    pane_id: format!("p{i}"),
                    title: None,
                    body: "b".into(),
                    notification_type: "info".into(),
                    event_seq: "1".into(),
                    occurred_at: 1,
                    severity: Severity::Info,
                    notif_id: None,
                };
                let bytes = serialized_len(&envelope);
                client.data.push_back(QueuedData { envelope, bytes });
                client.data_bytes += bytes;
            }
        }

        // Trip overflow: drop_queued_deltas finds nothing droppable, yet resync_required + the
        // recovery snapshot must still land within DATA_QUEUE_MSGS / DATA_QUEUE_BYTES.
        notifier.broadcast_test_delta("trigger", 1);

        let (len, bytes) = {
            let hub = notifier.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let client = hub.clients.get(&registration.conn_id).unwrap();
            (client.data.len(), client.data_bytes)
        };
        assert!(len <= DATA_QUEUE_MSGS, "queue exceeded message bound: {len}");
        assert!(bytes <= DATA_QUEUE_BYTES, "queue exceeded byte bound: {bytes}");

        // Whatever survives eviction, FIFO ordering must still hold: a resync_required (if
        // present) must precede any snapshot.
        let mut saw_resync = false;
        while let Some(envelope) = notifier.take_data(registration.conn_id) {
            match envelope {
                ServerEnvelope::ResyncRequired { .. } => saw_resync = true,
                ServerEnvelope::Snapshot { .. } => {
                    assert!(saw_resync, "snapshot must not precede resync_required");
                }
                _ => {}
            }
        }
        assert!(saw_resync, "expected resync_required to have survived eviction");
    }

    #[test]
    fn full_control_lane_requests_disconnect_without_blocking_ledger() {
        let notifier = NotificationBroadcast::new();
        let registration = notifier.register_client();

        notifier.fill_control_for_test(registration.conn_id);
        assert!(notifier.client_disconnect_requested(registration.conn_id));

        // A subsequent ledger mutation and snapshot prove the hub mutex was released rather than
        // waiting for control-lane capacity.
        let before = notifier.snapshot().revision;
        let delta = notifier.broadcast_test_delta("still-responsive", 10);
        assert_eq!(delta.revision, before + 1);
        assert_eq!(notifier.snapshot().revision, delta.revision);
    }

    #[test]
    fn multi_target_mark_read_broadcasts_one_single_revision_delta() {
        let notifier = NotificationBroadcast::new();
        let now = now_ms();
        notifier.broadcast_test_delta("pane-a", now);
        notifier.broadcast_test_delta("pane-b", now + 1);
        let notif_id = accepted_notif_id(
            notifier
                .process_notify(notify_request(Some("producer"), Some("multi"), None), |_| true),
        );
        let snapshot = notifier.snapshot();
        let mut registration = notifier.register_client();
        assert!(matches!(
            notifier.take_data(registration.conn_id),
            Some(ServerEnvelope::Snapshot { .. })
        ));

        let request =
            mark_read_request(&snapshot, "multi-read", &["pane-a", "pane-b"], &[&notif_id]);
        notifier.apply_mark_read(registration.conn_id, &request);

        let result = match registration.control.try_recv().unwrap() {
            ServerEnvelope::MarkReadResult { result } => result,
            other => panic!("expected mark_read_result, got {other:?}"),
        };
        let delta = match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::StateDelta { delta }) => delta,
            other => panic!("expected one state_delta, got {other:?}"),
        };
        assert_eq!(result.applied_at_revision, Some(delta.revision));
        assert_eq!(delta.panes.len(), 2);
        assert_eq!(delta.notifs.len(), 1);
        assert_eq!(result.results.len(), 3);
        assert!(result.results.iter().all(|target| target.status == TargetStatus::Applied));
        assert!(notifier.take_data(registration.conn_id).is_none());
    }

    #[test]
    fn mark_read_happy_path_returns_per_target_results_and_delta() {
        let notifier = NotificationBroadcast::new();
        notifier.broadcast_test_delta("pane", now_ms());
        let notif_id = accepted_notif_id(
            notifier
                .process_notify(notify_request(Some("producer"), Some("happy"), None), |_| true),
        );
        let snapshot = notifier.snapshot();
        let mut registration = notifier.register_client();
        notifier.take_data(registration.conn_id).unwrap();

        let request = mark_read_request(&snapshot, "happy-read", &["pane"], &[&notif_id]);
        notifier.apply_mark_read(registration.conn_id, &request);

        let result = match registration.control.try_recv().unwrap() {
            ServerEnvelope::MarkReadResult { result } => result,
            other => panic!("expected mark_read_result, got {other:?}"),
        };
        let delta = match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::StateDelta { delta }) => delta,
            other => panic!("expected state_delta, got {other:?}"),
        };
        assert_eq!(result.request_id, "happy-read");
        assert_eq!(result.applied_at_revision, Some(delta.revision));
        assert_eq!(result.results.len(), 2);
        assert!(result.results.iter().all(|target| target.status == TargetStatus::Applied));
        assert_eq!(delta.panes.len(), 1);
        assert_eq!(delta.notifs.len(), 1);
    }

    #[test]
    fn already_read_target_acks_current_revision_without_delta() {
        let notifier = NotificationBroadcast::new();
        notifier.broadcast_test_delta("pane", now_ms());
        let snapshot = notifier.snapshot();
        let mut registration = notifier.register_client();
        notifier.take_data(registration.conn_id).unwrap();

        let first = mark_read_request(&snapshot, "first-read", &["pane"], &[]);
        notifier.apply_mark_read(registration.conn_id, &first);
        registration.control.try_recv().unwrap();
        notifier.take_data(registration.conn_id).unwrap();
        let current_revision = notifier.snapshot().revision;

        let replay_as_new_request = mark_read_request(&snapshot, "already-read", &["pane"], &[]);
        notifier.apply_mark_read(registration.conn_id, &replay_as_new_request);
        let result = match registration.control.try_recv().unwrap() {
            ServerEnvelope::MarkReadResult { result } => result,
            other => panic!("expected mark_read_result, got {other:?}"),
        };

        assert_eq!(result.applied_at_revision, Some(current_revision));
        assert_eq!(result.results[0].status, TargetStatus::Applied);
        assert_eq!(notifier.snapshot().revision, current_revision);
        assert!(notifier.take_data(registration.conn_id).is_none());
    }

    #[test]
    fn producer_replay_returns_cached_outcome_without_second_notif_id() {
        let notifier = NotificationBroadcast::new();
        let request = notify_request(Some("producer-client"), Some("request-1"), None);

        let first = notifier.process_notify(request.clone(), |_| true);
        let second = notifier.process_notify(request, |_| true);

        assert_eq!(second, first);
        let snapshot = notifier.snapshot();
        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.notifs.len(), 1);
    }

    #[tokio::test]
    async fn legacy_post_notify_without_dedup_ids_works_end_to_end() {
        let notifier = Arc::new(NotificationBroadcast::new());
        let manager = Arc::new(SessionManager::new());
        let request = notify_request(None, None, None);

        let response = post_notify(
            State((Arc::clone(&notifier), manager)),
            Ok::<_, JsonRejection>(Json(request)),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert!(body.get("notifId").and_then(serde_json::Value::as_str).is_some());
        assert_eq!(notifier.snapshot().notifs.len(), 1);
    }

    #[test]
    fn unknown_pane_outcome_is_cached_without_creating_ghost_identity() {
        let notifier = NotificationBroadcast::new();
        let pane_id = Uuid::new_v4().to_string();
        let request = notify_request(Some("producer-client"), Some("missing-pane"), Some(&pane_id));
        let liveness_checks = Cell::new(0);

        let first = notifier.process_notify(request.clone(), |_| {
            liveness_checks.set(liveness_checks.get() + 1);
            false
        });
        let second = notifier.process_notify(request, |_| {
            liveness_checks.set(liveness_checks.get() + 1);
            false
        });

        assert_eq!(first, ProducerProcessResult::Outcome(ProducerOutcome::NotFound));
        assert_eq!(second, first);
        assert_eq!(liveness_checks.get(), 1, "replay should use the cached not_found outcome");
        assert_eq!(producer_response(ProducerOutcome::NotFound).status(), StatusCode::NOT_FOUND);
        let snapshot = notifier.snapshot();
        assert_eq!(snapshot.revision, 0);
        assert!(snapshot.panes.is_empty());
        assert!(snapshot.notifs.is_empty());
    }

    #[test]
    fn registered_client_receives_snapshot_then_newer_delta_fifo() {
        let notifier = NotificationBroadcast::new();
        let registration = notifier.register_client();
        let delta = notifier.broadcast_test_delta("pane", 10);

        let snapshot = match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::Snapshot { snapshot }) => snapshot,
            other => panic!("snapshot must be first, got {other:?}"),
        };
        let queued_delta = match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::StateDelta { delta }) => delta,
            other => panic!("delta must follow snapshot, got {other:?}"),
        };

        assert_eq!(queued_delta, delta);
        assert!(queued_delta.revision > snapshot.revision);
        assert!(notifier.take_data(registration.conn_id).is_none());
    }

    #[test]
    fn wake_coalescing_survives_many_enqueues_without_disconnect() {
        let notifier = NotificationBroadcast::new();
        let mut registration = notifier.register_client();
        registration.data_wake.try_recv().unwrap();
        notifier.take_data(registration.conn_id).unwrap(); // snapshot

        // Enqueue far more state deltas than the wake channel's capacity-1 token could carry one
        // per message. Coalescing (Full => success) must never trip disconnect.
        for i in 0..64u64 {
            notifier.broadcast_test_delta("pane", i);
        }
        assert!(!notifier.client_disconnect_requested(registration.conn_id));

        // A single wake token can drain the whole queue.
        registration.data_wake.try_recv().unwrap();
        let mut drained = 0;
        while notifier.take_data(registration.conn_id).is_some() {
            drained += 1;
        }
        assert_eq!(drained, 64);
        assert!(!notifier.client_disconnect_requested(registration.conn_id));
    }

    #[test]
    fn legacy_snake_case_notify_body_deserializes_pane_and_severity() {
        // Exact body from docs/notifications.en.md's Claude Code hook example (line 72).
        let body = r#"{"body":"Claude needs your input","title":"Claude Code","notification_type":"warning","pane_id":"11111111-1111-1111-1111-111111111111"}"#;
        let req: NotifyRequest = serde_json::from_str(body).unwrap();
        assert_eq!(
            req.pane_id.as_deref(),
            Some("11111111-1111-1111-1111-111111111111"),
            "legacy snake_case pane_id must deserialize"
        );
        assert_eq!(severity_from_type(&req.notification_type), Some(Severity::Warning));
    }

    #[test]
    fn pane_closed_broadcasts_removal_delta() {
        let notifier = NotificationBroadcast::new();
        notifier.broadcast_test_delta("pane", now_ms());
        let registration = notifier.register_client();
        notifier.take_data(registration.conn_id).unwrap(); // snapshot

        notifier.pane_closed("pane");

        let delta = match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::StateDelta { delta }) => delta,
            other => panic!("expected removal delta, got {other:?}"),
        };
        assert!(delta.panes.iter().any(|p| p.pane_id == "pane" && p.removed == Some(true)));
    }

    #[test]
    fn pane_closed_on_untracked_pane_is_a_harmless_noop() {
        let notifier = NotificationBroadcast::new();
        // Must not panic and must not fabricate ledger state for a pane that never had an event.
        notifier.pane_closed("never-tracked");
        assert!(notifier.snapshot().panes.is_empty());
    }

    #[test]
    fn dedup_in_flight_during_mark_read_produces_no_control_message() {
        let notifier = NotificationBroadcast::new();
        notifier.broadcast_test_delta("pane", now_ms());
        let snapshot = notifier.snapshot();
        let mut registration = notifier.register_client();
        notifier.take_data(registration.conn_id).unwrap(); // snapshot

        let request = mark_read_request(&snapshot, "in-flight-read", &["pane"], &[]);
        {
            // Manually reserve the dedup key WITHOUT completing, simulating the zombie
            // in-flight window that is otherwise unreachable under the synchronous critical
            // section.
            let mut hub = notifier.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let key = (request.client_id.clone(), request.request_id.clone());
            let hash = payload_hash(&("notification.mark_read", &request));
            let reserved = hub.ledger.reserve(&key.0, &key.1, hash, now_ms());
            assert!(matches!(reserved, ReserveResult::Reserved { .. }));
        }

        notifier.apply_mark_read(registration.conn_id, &request);

        assert!(matches!(registration.control.try_recv(), Err(TryRecvError::Empty)));
    }

    #[tokio::test]
    async fn producer_in_flight_reservation_returns_503_retry() {
        let notifier = Arc::new(NotificationBroadcast::new());
        let manager = Arc::new(SessionManager::new());
        let request = notify_request(Some("producer"), Some("in-flight"), None);
        {
            let mut hub = notifier.hub.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let hash = payload_hash(&("producer.notify", &request));
            let reserved = hub.ledger.reserve("producer", "in-flight", hash, now_ms());
            assert!(matches!(reserved, ReserveResult::Reserved { .. }));
        }

        let response = post_notify(
            State((Arc::clone(&notifier), manager)),
            Ok::<_, JsonRejection>(Json(request)),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = response_json(response).await;
        assert_eq!(body.get("status").and_then(serde_json::Value::as_str), Some("retry"));
    }

    #[test]
    fn legacy_snake_case_body_through_process_notify_targets_live_pane() {
        // Exact body shape from docs/notifications.en.md's Claude Code hook example (line 72),
        // driven through the real dispatch (process_notify, which post_notify calls) with a LIVE
        // pane (liveness closure true) — unlike the pure-deserialization test above, this
        // exercises the full accepted path: gate, liveness check, record, response shape.
        let notifier = NotificationBroadcast::new();
        let pane_id = Uuid::new_v4().to_string();
        let body = format!(
            r#"{{"body":"Claude needs your input","title":"Claude Code","notification_type":"warning","pane_id":"{pane_id}"}}"#
        );
        let req: NotifyRequest = serde_json::from_str(&body).unwrap();

        let result = notifier.process_notify(req, |_| true);
        match result {
            ProducerProcessResult::Outcome(ProducerOutcome::AcceptedPane {
                pane_id: accepted_pane,
                ..
            }) => assert_eq!(accepted_pane, pane_id),
            other => panic!("expected accepted pane-targeted notification, got {other:?}"),
        }

        let snapshot = notifier.snapshot();
        let pane = snapshot.panes.iter().find(|p| p.pane_id == pane_id).expect("pane recorded");
        assert_eq!(pane.severity, Some(Severity::Warning));
    }

    #[test]
    fn accepted_producer_event_invokes_hooks_exactly_once() {
        let notifier = NotificationBroadcast::new();
        let request = notify_request(Some("hook-client"), Some("hook-accept"), None);
        let result = notifier.process_notify(request, |_| true);
        assert!(matches!(
            result,
            ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { .. })
        ));
        assert_eq!(notifier.hook_invocation_count(), 1);
    }

    #[test]
    fn replayed_and_suppressed_producer_events_never_invoke_hooks() {
        let notifier = NotificationBroadcast::new();
        let request = notify_request(Some("hook-client"), Some("hook-replay"), None);

        // First call accepts (and invokes hooks once); the second is a pure dedup replay.
        let first = notifier.process_notify(request.clone(), |_| true);
        assert!(matches!(
            first,
            ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { .. })
        ));
        assert_eq!(notifier.hook_invocation_count(), 1);

        let second = notifier.process_notify(request, |_| true);
        assert_eq!(second, first, "replay must return the cached outcome verbatim");
        assert_eq!(
            notifier.hook_invocation_count(),
            1,
            "replay must never invoke hooks a second time"
        );

        // Now exercise a GENUINELY suppressed outcome (the above never actually produced one):
        // disable notification ingest, then issue a brand-new requestId.
        let settings_state: SettingsState =
            Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
        notifier.set_settings(settings_state.clone());
        settings_state.try_write().unwrap().notification.enabled = false;

        let suppressed_request = notify_request(Some("hook-client"), Some("hook-suppressed"), None);
        let suppressed = notifier.process_notify(suppressed_request.clone(), |_| true);
        assert!(
            matches!(
                suppressed,
                ProducerProcessResult::Outcome(ProducerOutcome::Suppressed { .. })
            ),
            "expected a suppressed outcome, got {suppressed:?}"
        );
        assert_eq!(
            notifier.hook_invocation_count(),
            1,
            "suppressed events must never invoke hooks"
        );

        // Re-enable, then replay the SAME suppressed key — must return the cached suppressed
        // outcome (not re-evaluate the gate), and must still never invoke hooks.
        settings_state.try_write().unwrap().notification.enabled = true;
        let replayed_suppressed = notifier.process_notify(suppressed_request, |_| true);
        assert_eq!(
            replayed_suppressed, suppressed,
            "replay must return the cached suppressed outcome verbatim"
        );
        assert_eq!(notifier.hook_invocation_count(), 1);
    }

    #[test]
    fn idle_reminder_is_suppressed_without_broadcast_when_disabled() {
        let notifier = NotificationBroadcast::new();
        let settings_state: SettingsState =
            Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
        notifier.set_settings(settings_state.clone());
        settings_state.try_write().unwrap().notification.idle_reminder = false;

        let mut registration = notifier.register_client();
        assert!(matches!(
            notifier.take_data(registration.conn_id),
            Some(ServerEnvelope::Snapshot { .. })
        ));
        registration.data_wake.try_recv().unwrap();

        let mut request = notify_request(Some("idle-client"), Some("idle-disabled"), None);
        request.category = Some("idle_reminder".into());
        let result = notifier.process_notify(request, |_| true);

        assert_eq!(
            result,
            ProducerProcessResult::Outcome(ProducerOutcome::Suppressed {
                reason: "idle_reminder_disabled".into(),
            })
        );
        assert!(notifier.take_data(registration.conn_id).is_none());
        assert!(matches!(registration.data_wake.try_recv(), Err(TryRecvError::Empty)));
        let snapshot = notifier.snapshot();
        assert_eq!(snapshot.revision, 0);
        assert!(snapshot.panes.is_empty());
        assert!(snapshot.notifs.is_empty());
    }

    #[test]
    fn notification_disabled_precedes_idle_reminder_disabled_and_replays() {
        let notifier = NotificationBroadcast::new();
        let settings_state: SettingsState =
            Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
        notifier.set_settings(settings_state.clone());
        {
            let mut settings = settings_state.try_write().unwrap();
            settings.notification.enabled = false;
            settings.notification.idle_reminder = false;
        }

        let mut request = notify_request(Some("idle-client"), Some("global-disabled"), None);
        request.category = Some("idle_reminder".into());
        let first = notifier.process_notify(request.clone(), |_| true);

        assert_eq!(
            first,
            ProducerProcessResult::Outcome(ProducerOutcome::Suppressed {
                reason: "notification_disabled".into(),
            })
        );

        {
            let mut settings = settings_state.try_write().unwrap();
            settings.notification.enabled = true;
            settings.notification.idle_reminder = true;
        }
        let replay = notifier.process_notify(request, |_| true);

        assert_eq!(replay, first, "replay must return the cached global-gate outcome");
        let snapshot = notifier.snapshot();
        assert_eq!(snapshot.revision, 0);
        assert!(snapshot.notifs.is_empty());
    }

    #[test]
    fn idle_reminder_is_accepted_when_enabled() {
        let notifier = NotificationBroadcast::new();
        let settings_state: SettingsState =
            Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
        notifier.set_settings(settings_state.clone());
        settings_state.try_write().unwrap().notification.idle_reminder = true;

        let mut request = notify_request(Some("idle-client"), Some("idle-enabled"), None);
        request.category = Some("idle_reminder".into());
        let result = notifier.process_notify(request, |_| true);

        assert!(matches!(
            result,
            ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { .. })
        ));
        assert_eq!(notifier.snapshot().notifs.len(), 1);
    }

    #[test]
    fn notification_without_category_is_unaffected_when_idle_reminder_is_disabled() {
        let notifier = NotificationBroadcast::new();
        let settings_state: SettingsState =
            Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
        notifier.set_settings(settings_state.clone());
        settings_state.try_write().unwrap().notification.idle_reminder = false;

        let request = notify_request(Some("idle-client"), Some("uncategorized"), None);
        let result = notifier.process_notify(request, |_| true);

        assert!(matches!(
            result,
            ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { .. })
        ));
        assert_eq!(notifier.snapshot().notifs.len(), 1);
    }

    #[test]
    fn pane_closed_notify_is_a_noop_before_a_notifier_is_registered() {
        // A bare SessionManager (as constructed in unit tests elsewhere in this crate) must not
        // panic when a removal site calls pane_closed_notify before start_cleanup_task has ever
        // registered a notifier.
        let manager = SessionManager::new();
        manager.pane_closed_notify("never-registered");
    }

    #[test]
    fn register_notifier_wiring_broadcasts_removal_delta() {
        // Covers the register_notifier/pane_closed_notify wiring itself (independent of
        // start_cleanup_task, per the H4 signature split: registration must never depend on the
        // reaper task actually starting). The full natural-exit path via kill_and_remove — with a
        // real session entry — is covered in
        // session::kill_and_remove_notifier_tests::kill_and_remove_notifies_attention_ledger_with_a_single_removal_delta.
        // Live PTY/SSH exit remains a QA-stage exercise.
        let notifier = Arc::new(NotificationBroadcast::new());
        let manager = SessionManager::new();
        manager.register_notifier(Arc::clone(&notifier));

        notifier.broadcast_test_delta("pane", now_ms());
        let registration = notifier.register_client();
        notifier.take_data(registration.conn_id).unwrap(); // snapshot

        manager.pane_closed_notify("pane");

        let delta = match notifier.take_data(registration.conn_id) {
            Some(ServerEnvelope::StateDelta { delta }) => delta,
            other => panic!("expected removal delta, got {other:?}"),
        };
        assert!(delta.panes.iter().any(|p| p.pane_id == "pane" && p.removed == Some(true)));
    }
}
