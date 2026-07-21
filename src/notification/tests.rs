use std::cell::Cell;
use std::sync::Arc;

use axum::body::to_bytes;
use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::Response,
    Json,
};
use tokio::sync::mpsc::error::TryRecvError;
use uuid::Uuid;

use crate::attention::{ProducerOutcome, ReserveResult, Severity, Snapshot, TargetStatus};
use crate::session::SessionManager;
use crate::settings::{Settings, SettingsState};

use super::broadcast::NotificationBroadcast;
use super::client::QueuedData;
use super::handler::{post_notify, producer_response};
use super::protocol::ServerEnvelope;
use super::types::{
    MarkReadNotif, MarkReadPane, MarkReadReason, MarkReadRequest, NotifyRequest,
    ProducerProcessResult,
};
use super::util::{now_ms, payload_hash, serialized_len, severity_from_type};
use super::{DATA_QUEUE_BYTES, DATA_QUEUE_MSGS, MIN_PROTOCOL_VERSION};

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
        ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { notif_id, .. }) => notif_id,
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
        // recovery snapshot) - detect that transition and stop right there.
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
    // resync_required + the recovery snapshot push it past the aggregate bound -
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
        notifier.process_notify(notify_request(Some("producer"), Some("multi"), None), |_| true),
    );
    let snapshot = notifier.snapshot();
    let mut registration = notifier.register_client();
    assert!(matches!(
        notifier.take_data(registration.conn_id),
        Some(ServerEnvelope::Snapshot { .. })
    ));

    let request = mark_read_request(&snapshot, "multi-read", &["pane-a", "pane-b"], &[&notif_id]);
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
        notifier.process_notify(notify_request(Some("producer"), Some("happy"), None), |_| true),
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

    let response =
        post_notify(State((Arc::clone(&notifier), manager)), Ok::<_, JsonRejection>(Json(request)))
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

    let response =
        post_notify(State((Arc::clone(&notifier), manager)), Ok::<_, JsonRejection>(Json(request)))
            .await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response_json(response).await;
    assert_eq!(body.get("status").and_then(serde_json::Value::as_str), Some("retry"));
}

#[test]
fn legacy_snake_case_body_through_process_notify_targets_live_pane() {
    // Exact body shape from docs/notifications.en.md's Claude Code hook example (line 72),
    // driven through the real dispatch (process_notify, which post_notify calls) with a LIVE
    // pane (liveness closure true) - unlike the pure-deserialization test above, this
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
    assert!(matches!(first, ProducerProcessResult::Outcome(ProducerOutcome::AcceptedNotif { .. })));
    assert_eq!(notifier.hook_invocation_count(), 1);

    let second = notifier.process_notify(request, |_| true);
    assert_eq!(second, first, "replay must return the cached outcome verbatim");
    assert_eq!(notifier.hook_invocation_count(), 1, "replay must never invoke hooks a second time");

    // Now exercise a GENUINELY suppressed outcome (the above never actually produced one):
    // disable notification ingest, then issue a brand-new requestId.
    let settings_state: SettingsState = Arc::new(tokio::sync::RwLock::new(Settings::default()));
    notifier.set_settings(settings_state.clone());
    settings_state.try_write().unwrap().notification.enabled = false;

    let suppressed_request = notify_request(Some("hook-client"), Some("hook-suppressed"), None);
    let suppressed = notifier.process_notify(suppressed_request.clone(), |_| true);
    assert!(
        matches!(suppressed, ProducerProcessResult::Outcome(ProducerOutcome::Suppressed { .. })),
        "expected a suppressed outcome, got {suppressed:?}"
    );
    assert_eq!(notifier.hook_invocation_count(), 1, "suppressed events must never invoke hooks");

    // Re-enable, then replay the SAME suppressed key - must return the cached suppressed
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
    let settings_state: SettingsState = Arc::new(tokio::sync::RwLock::new(Settings::default()));
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
    let settings_state: SettingsState = Arc::new(tokio::sync::RwLock::new(Settings::default()));
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
    let settings_state: SettingsState = Arc::new(tokio::sync::RwLock::new(Settings::default()));
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
    let settings_state: SettingsState = Arc::new(tokio::sync::RwLock::new(Settings::default()));
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
    // reaper task actually starting). The full natural-exit path via kill_and_remove - with a
    // real session entry - is covered in
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
