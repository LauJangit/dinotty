use tokio::sync::mpsc;

use super::client::{ClientHandle, LedgerHub};
use super::protocol::ServerEnvelope;
use super::util::serialized_len;
use super::{ConnId, DATA_QUEUE_BYTES, DATA_QUEUE_MSGS, MIN_PROTOCOL_VERSION};

pub(crate) fn broadcast_data(
    hub: &mut LedgerHub,
    first: ServerEnvelope,
    second: Option<ServerEnvelope>,
) {
    let ids: Vec<_> = hub.clients.keys().copied().collect();
    for conn_id in ids {
        enqueue_data(hub, conn_id, first.clone());
        if let Some(second) = &second {
            enqueue_data(hub, conn_id, second.clone());
        }
    }
}

pub(crate) fn enqueue_data(hub: &mut LedgerHub, conn_id: ConnId, envelope: ServerEnvelope) {
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
            // awaiting_snapshot - silently discarding every future delta. drop_queued_deltas just
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

pub(crate) fn enqueue_data_direct(client: &mut ClientHandle, envelope: ServerEnvelope) {
    let bytes = serialized_len(&envelope);
    if bytes > DATA_QUEUE_BYTES {
        // Cannot ever fit, even against an empty queue.
        request_disconnect(client);
        return;
    }
    // A `Full` wake token means a wake is already pending for the writer to drain the queue -
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
    // insert path here, not just the ordinary delta fast-path - a queue full of non-droppable
    // envelopes (raised Bell/Notify cues, a stale Snapshot) must not let resync_required/the
    // recovery snapshot push it over the limit. Evict the OLDEST entries until there's room:
    // raised cues are expendable presentation (design §13 accepts card-body gaps) and a queued
    // stale Snapshot is superseded by whichever snapshot follows. ResyncRequired is EXEMPT from
    // eviction: frames are small, and each overflow cycle adds at most one before its recovery
    // snapshot clears resync_enqueued (so multiple resync frames CAN coexist across separate
    // overflow cycles, but their aggregate stays negligible) - losing one would leave the client
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
    client.data.push_back(super::client::QueuedData { envelope, bytes });
    client.data_bytes += bytes;
    debug_assert!(client.data.len() <= DATA_QUEUE_MSGS, "data queue exceeded message bound");
    debug_assert!(client.data_bytes <= DATA_QUEUE_BYTES, "data queue exceeded byte bound");
}

pub(crate) fn drop_queued_deltas(client: &mut ClientHandle) {
    client.data.retain(|queued| {
        if queued.envelope.is_state_delta() {
            client.data_bytes = client.data_bytes.saturating_sub(queued.bytes);
            false
        } else {
            true
        }
    });
}

pub(crate) fn schedule_recovery_snapshot(hub: &mut LedgerHub, conn_id: ConnId) {
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

pub(crate) fn enqueue_control(hub: &mut LedgerHub, conn_id: ConnId, envelope: ServerEnvelope) {
    let Some(client) = hub.clients.get_mut(&conn_id) else { return };
    if client.disconnect_requested {
        return;
    }
    if client.control.try_send(envelope).is_err() {
        request_disconnect(client);
    }
}

pub(crate) fn request_disconnect(client: &mut ClientHandle) {
    client.disconnect_requested = true;
    let _ = client.disconnect.send(true);
}
