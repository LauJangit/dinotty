//! Backend-authoritative notification attention state.
//!
//! This module deliberately contains only data and deterministic ledger logic. Transport,
//! locking, blocking dedup waiters, and producer validation belong to integration layers.

#![allow(
    clippy::expect_used,
    clippy::field_reassign_with_default,
    clippy::match_same_arms,
    clippy::must_use_candidate,
    clippy::needless_pass_by_value,
    clippy::ref_option,
    clippy::trivially_copy_pass_by_ref
)]

use std::collections::{HashMap, VecDeque};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::settings::NotificationConfig;

/// Memory and retention bounds for attention state and request deduplication.
pub const UNREAD_CAP: usize = 100;
/// Maximum age of an unread event and retention period for fully-read identities.
pub const UNREAD_TTL: u64 = 72 * 60 * 60 * 1_000;
/// Maximum number of pane identities and pane-less notification identities, independently.
pub const IDENTITY_CAP: usize = 512;
/// Completed request replay horizon, measured from completion time.
pub const DEDUP_TTL: u64 = 10 * 60 * 1_000;
/// Maximum age of an unfinished reservation before it may be reclaimed.
pub const RESERVATION_TIMEOUT: u64 = 30 * 1_000;

mod decimal_string {
    use serde::Serializer;

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }
}

mod optional_decimal_string {
    use serde::Serializer;

    pub fn serialize<S>(value: &Option<u64>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(value) => serializer.serialize_some(&value.to_string()),
            None => serializer.serialize_none(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Success,
    Warning,
    Error,
    Urgent,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnreadEvent {
    pub seq: u64,
    pub occurred_at: u64,
    pub severity: Severity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaneAttention {
    pub read_through_seq: u64,
    pub latest_event_seq: u64,
    pub unread: VecDeque<UnreadEvent>,
    pub read_at: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotifAttention {
    pub event_seq: u64,
    pub occurred_at: u64,
    pub severity: Severity,
    pub read: bool,
    pub read_at: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DedupEntry {
    payload_hash: u64,
    state: DedupState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DedupState {
    InFlight { reserved_at: u64, generation: u64 },
    Done { done_at: u64, outcome: DedupOutcome },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DedupOutcome {
    MarkRead(MarkReadResult),
    Producer(ProducerOutcome),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ProducerOutcome {
    #[serde(rename = "accepted")]
    AcceptedPane {
        #[serde(rename = "paneId")]
        pane_id: String,
        #[serde(rename = "eventSeq", with = "decimal_string")]
        event_seq: u64,
        #[serde(with = "decimal_string")]
        revision: u64,
    },
    #[serde(rename = "accepted")]
    AcceptedNotif {
        #[serde(rename = "notifId")]
        notif_id: String,
        #[serde(rename = "eventSeq", with = "decimal_string")]
        event_seq: u64,
        #[serde(with = "decimal_string")]
        revision: u64,
    },
    Suppressed {
        reason: String,
    },
    NotFound,
}

#[derive(Clone, Debug)]
pub struct AttentionLedger {
    epoch: String,
    next_event_seq: u64,
    next_dedup_generation: u64,
    revision: u64,
    panes: HashMap<String, PaneAttention>,
    notifs: HashMap<String, NotifAttention>,
    dedup: HashMap<(String, String), DedupEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateDelta {
    pub epoch: String,
    #[serde(with = "decimal_string")]
    pub revision: u64,
    pub panes: Vec<PaneDelta>,
    pub notifs: Vec<NotifDelta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneDelta {
    pub pane_id: String,
    #[serde(with = "optional_decimal_string")]
    pub latest_event_seq: Option<u64>,
    #[serde(with = "optional_decimal_string")]
    pub read_through_seq: Option<u64>,
    pub first_unread_at: Option<u64>,
    pub severity: Option<Severity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifDelta {
    pub notif_id: String,
    pub read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub epoch: String,
    #[serde(with = "decimal_string")]
    pub revision: u64,
    pub panes: Vec<PaneDelta>,
    pub notifs: Vec<NotifDelta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadResult {
    pub request_id: String,
    pub epoch: String,
    #[serde(with = "optional_decimal_string")]
    pub applied_at_revision: Option<u64>,
    pub results: Vec<TargetResult>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TargetResult {
    pub target: AttentionTarget,
    pub status: TargetStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum AttentionTarget {
    Pane {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Notif {
        #[serde(rename = "notifId")]
        notif_id: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetStatus {
    Applied,
    StaleEpoch,
    Invalid,
    NotFound,
    Conflict,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReserveResult {
    Reserved { generation: u64 },
    Replay(DedupOutcome),
    Conflict,
    InFlight,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IngestSource {
    Bell { debounce_duplicate: bool },
    OscNotify,
    CommandComplete { matched_rule: bool },
    KeywordMatch { matched_rule: bool },
    Plugin,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IngestGateResult {
    Accepted,
    Suppressed(String),
}

/// Evaluates the configuration-dependent ingest gate before an event sequence is allocated.
///
/// `matched_rule` and `debounce_duplicate` must be computed by the caller from the current
/// configuration and attention state.
pub fn evaluate_ingest_gate(cfg: &NotificationConfig, source: IngestSource) -> IngestGateResult {
    if !cfg.enabled {
        return IngestGateResult::Suppressed("notification_disabled".into());
    }

    match source {
        IngestSource::Bell { .. } if !cfg.bell.enabled => {
            IngestGateResult::Suppressed("bell_disabled".into())
        }
        IngestSource::Bell { debounce_duplicate: true } => {
            IngestGateResult::Suppressed("bell_debounce_duplicate".into())
        }
        IngestSource::Bell { debounce_duplicate: false } | IngestSource::Plugin => {
            IngestGateResult::Accepted
        }
        IngestSource::OscNotify if cfg.osc_notify => IngestGateResult::Accepted,
        IngestSource::OscNotify => IngestGateResult::Suppressed("osc_notify_disabled".into()),
        IngestSource::CommandComplete { matched_rule }
            if cfg.command_complete.enabled && matched_rule =>
        {
            IngestGateResult::Accepted
        }
        IngestSource::CommandComplete { .. } => {
            IngestGateResult::Suppressed("command_complete_not_matched".into())
        }
        IngestSource::KeywordMatch { matched_rule } if matched_rule => IngestGateResult::Accepted,
        IngestSource::KeywordMatch { .. } => {
            IngestGateResult::Suppressed("keyword_match_not_matched".into())
        }
    }
}

impl AttentionLedger {
    #[must_use]
    pub fn new() -> Self {
        Self::with_epoch(Uuid::new_v4().to_string())
    }

    #[must_use]
    pub fn with_epoch(epoch: String) -> Self {
        Self {
            epoch,
            next_event_seq: 1,
            next_dedup_generation: 1,
            revision: 0,
            panes: HashMap::new(),
            notifs: HashMap::new(),
            dedup: HashMap::new(),
        }
    }

    #[must_use]
    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    #[must_use]
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn record_pane_event(
        &mut self,
        pane_id: impl Into<String>,
        occurred_at: u64,
        severity: Severity,
        now_ms: u64,
    ) -> (u64, StateDelta) {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);

        let pane_id = pane_id.into();
        let event_seq = self.take_event_seq();
        let pane = self.panes.entry(pane_id.clone()).or_insert_with(|| PaneAttention {
            read_through_seq: 0,
            latest_event_seq: 0,
            unread: VecDeque::new(),
            read_at: None,
        });
        pane.latest_event_seq = event_seq;
        pane.unread.push_back(UnreadEvent { seq: event_seq, occurred_at, severity });
        pane.read_at = None;

        while pane.unread.len() > UNREAD_CAP {
            if let Some(dropped) = pane.unread.pop_front() {
                tracing::warn!(
                    pane_id,
                    event_seq = dropped.seq,
                    "[unread-drop] per-pane unread cap exceeded"
                );
            }
        }

        upsert_pane_delta(&mut pane_deltas, self.pane_delta(&pane_id));
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        let revision = self.bump_revision();
        (event_seq, self.delta(revision, pane_deltas, notif_deltas))
    }

    pub fn record_notif_event(
        &mut self,
        notif_id: impl Into<String>,
        occurred_at: u64,
        severity: Severity,
        now_ms: u64,
    ) -> (u64, StateDelta) {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);

        let notif_id = notif_id.into();
        let event_seq = self.take_event_seq();
        self.notifs.insert(
            notif_id.clone(),
            NotifAttention { event_seq, occurred_at, severity, read: false, read_at: None },
        );

        upsert_notif_delta(&mut notif_deltas, self.notif_delta(&notif_id));
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        let revision = self.bump_revision();
        (event_seq, self.delta(revision, pane_deltas, notif_deltas))
    }

    pub fn mark_read(
        &mut self,
        epoch: &str,
        panes: &[(String, u64)],
        notifs: &[String],
        now_ms: u64,
    ) -> (Option<StateDelta>, Vec<TargetResult>, Option<u64>) {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);

        if epoch != self.epoch {
            let results = panes
                .iter()
                .map(|(pane_id, _)| TargetResult {
                    target: AttentionTarget::Pane { pane_id: pane_id.clone() },
                    status: TargetStatus::StaleEpoch,
                })
                .chain(notifs.iter().map(|notif_id| TargetResult {
                    target: AttentionTarget::Notif { notif_id: notif_id.clone() },
                    status: TargetStatus::StaleEpoch,
                }))
                .collect();
            self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
            let delta = self.finish_delta(pane_deltas, notif_deltas);
            return (delta, results, None);
        }

        let mut results = Vec::with_capacity(panes.len() + notifs.len());
        let mut accepted_any = false;
        let mut changed_panes = Vec::new();
        let mut changed_notifs = Vec::new();

        for (pane_id, through_seq) in panes {
            let status = match self.panes.get_mut(pane_id) {
                None => TargetStatus::NotFound,
                Some(pane) if *through_seq > pane.latest_event_seq => TargetStatus::Invalid,
                Some(pane) => {
                    accepted_any = true;
                    let old_watermark = pane.read_through_seq;
                    let was_unread = !pane.unread.is_empty();
                    pane.read_through_seq = pane.read_through_seq.max(*through_seq);
                    while pane
                        .unread
                        .front()
                        .is_some_and(|event| event.seq <= pane.read_through_seq)
                    {
                        pane.unread.pop_front();
                    }
                    if pane.unread.is_empty() && was_unread {
                        pane.read_through_seq = pane.latest_event_seq;
                        pane.read_at = Some(now_ms);
                    }
                    if pane.read_through_seq != old_watermark
                        || (was_unread && pane.unread.is_empty())
                    {
                        push_unique(&mut changed_panes, pane_id);
                    }
                    TargetStatus::Applied
                }
            };
            results.push(TargetResult {
                target: AttentionTarget::Pane { pane_id: pane_id.clone() },
                status,
            });
        }

        for notif_id in notifs {
            let status = match self.notifs.get_mut(notif_id) {
                None => TargetStatus::NotFound,
                Some(notif) => {
                    accepted_any = true;
                    if !notif.read {
                        notif.read = true;
                        notif.read_at = Some(now_ms);
                        push_unique(&mut changed_notifs, notif_id);
                    }
                    TargetStatus::Applied
                }
            };
            results.push(TargetResult {
                target: AttentionTarget::Notif { notif_id: notif_id.clone() },
                status,
            });
        }

        for id in changed_panes {
            upsert_pane_delta(&mut pane_deltas, self.pane_delta(&id));
        }
        for id in changed_notifs {
            upsert_notif_delta(&mut notif_deltas, self.notif_delta(&id));
        }
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);

        let delta = self.finish_delta(pane_deltas, notif_deltas);
        let applied_at_revision = accepted_any.then_some(self.revision);
        (delta, results, applied_at_revision)
    }

    pub fn pane_closed(&mut self, pane_id: &str, now_ms: u64) -> Option<StateDelta> {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);
        if self.panes.remove(pane_id).is_some() {
            upsert_pane_delta(&mut pane_deltas, PaneDelta::removed(pane_id));
        }
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        self.finish_delta(pane_deltas, notif_deltas)
    }

    /// Reserves a deduplication key for a caller that will mutate and complete under one lock.
    ///
    /// The integration layer normally holds one lock across reserve → mutate → complete. The
    /// generation guard protects the detached/reclaimed case, where a stale owner may finish
    /// after another caller has reclaimed the reservation.
    pub fn reserve(
        &mut self,
        client_id: impl Into<String>,
        request_id: impl Into<String>,
        payload_hash: u64,
        now_ms: u64,
    ) -> ReserveResult {
        let key = (client_id.into(), request_id.into());
        if let Some(entry) = self.dedup.get(&key) {
            match &entry.state {
                DedupState::InFlight { reserved_at, .. }
                    if is_expired(*reserved_at, RESERVATION_TIMEOUT, now_ms) => {}
                DedupState::Done { done_at, .. } if is_expired(*done_at, DEDUP_TTL, now_ms) => {}
                DedupState::InFlight { .. } if entry.payload_hash != payload_hash => {
                    return ReserveResult::Conflict;
                }
                DedupState::InFlight { .. } => return ReserveResult::InFlight,
                DedupState::Done { .. } if entry.payload_hash != payload_hash => {
                    return ReserveResult::Conflict;
                }
                DedupState::Done { outcome, .. } => {
                    return ReserveResult::Replay(outcome.clone());
                }
            }
        }

        let generation = self.take_dedup_generation();
        self.dedup.insert(
            key,
            DedupEntry {
                payload_hash,
                state: DedupState::InFlight { reserved_at: now_ms, generation },
            },
        );
        ReserveResult::Reserved { generation }
    }

    pub fn complete(
        &mut self,
        key: &(String, String),
        generation: u64,
        outcome: DedupOutcome,
        now_ms: u64,
    ) -> bool {
        let Some(entry) = self.dedup.get_mut(key) else {
            return false;
        };
        match entry.state {
            DedupState::InFlight { generation: active_generation, .. }
                if active_generation == generation =>
            {
                entry.state = DedupState::Done { done_at: now_ms, outcome };
                true
            }
            DedupState::InFlight { .. } | DedupState::Done { .. } => false,
        }
    }

    pub fn sweep(&mut self, now_ms: u64) -> Option<StateDelta> {
        let mut pane_deltas = Vec::new();
        let mut notif_deltas = Vec::new();
        self.expire_into(now_ms, &mut pane_deltas, &mut notif_deltas);
        self.enforce_identity_caps(&mut pane_deltas, &mut notif_deltas);
        self.finish_delta(pane_deltas, notif_deltas)
    }

    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        let mut panes: Vec<_> = self.panes.keys().map(|id| self.pane_delta(id)).collect();
        let mut notifs: Vec<_> = self.notifs.keys().map(|id| self.notif_delta(id)).collect();
        panes.sort_by(|a, b| a.pane_id.cmp(&b.pane_id));
        notifs.sort_by(|a, b| a.notif_id.cmp(&b.notif_id));
        Snapshot { epoch: self.epoch.clone(), revision: self.revision, panes, notifs }
    }

    #[must_use]
    pub fn first_unread_at(&self, pane_id: &str) -> Option<u64> {
        self.panes.get(pane_id)?.unread.front().map(|event| event.occurred_at)
    }

    fn expire_into(
        &mut self,
        now_ms: u64,
        pane_deltas: &mut Vec<PaneDelta>,
        notif_deltas: &mut Vec<NotifDelta>,
    ) {
        self.sweep_dedup(now_ms);

        let mut changed_panes = Vec::new();
        let mut changed_notifs = Vec::new();
        let mut removed_panes = Vec::new();
        let mut removed_notifs = Vec::new();

        for (pane_id, pane) in &mut self.panes {
            let old_unread_len = pane.unread.len();
            let was_unread = !pane.unread.is_empty();
            while pane
                .unread
                .front()
                .is_some_and(|event| is_expired(event.occurred_at, UNREAD_TTL, now_ms))
            {
                pane.unread.pop_front();
            }
            if was_unread && pane.unread.is_empty() {
                pane.read_through_seq = pane.latest_event_seq;
                pane.read_at = Some(now_ms);
                push_unique(&mut changed_panes, pane_id);
            } else if pane.unread.len() < old_unread_len {
                push_unique(&mut changed_panes, pane_id);
            }
        }

        for (notif_id, notif) in &mut self.notifs {
            if !notif.read && is_expired(notif.occurred_at, UNREAD_TTL, now_ms) {
                notif.read = true;
                notif.read_at = Some(now_ms);
                push_unique(&mut changed_notifs, notif_id);
            }
        }

        self.panes.retain(|pane_id, pane| {
            let collect = pane.unread.is_empty()
                && pane.read_at.is_some_and(|read_at| is_expired(read_at, UNREAD_TTL, now_ms));
            if collect {
                removed_panes.push(pane_id.clone());
            }
            !collect
        });
        self.notifs.retain(|notif_id, notif| {
            let collect = notif.read
                && notif.read_at.is_some_and(|read_at| is_expired(read_at, UNREAD_TTL, now_ms));
            if collect {
                removed_notifs.push(notif_id.clone());
            }
            !collect
        });

        for id in changed_panes {
            if self.panes.contains_key(&id) {
                upsert_pane_delta(pane_deltas, self.pane_delta(&id));
            }
        }
        for id in changed_notifs {
            if self.notifs.contains_key(&id) {
                upsert_notif_delta(notif_deltas, self.notif_delta(&id));
            }
        }
        for id in removed_panes {
            upsert_pane_delta(pane_deltas, PaneDelta::removed(&id));
        }
        for id in removed_notifs {
            upsert_notif_delta(notif_deltas, NotifDelta::removed(&id));
        }
    }

    fn sweep_dedup(&mut self, now_ms: u64) {
        self.dedup.retain(|_, entry| match &entry.state {
            DedupState::InFlight { reserved_at, .. } => {
                !is_expired(*reserved_at, RESERVATION_TIMEOUT, now_ms)
            }
            DedupState::Done { done_at, .. } => !is_expired(*done_at, DEDUP_TTL, now_ms),
        });
    }

    fn enforce_identity_caps(
        &mut self,
        pane_deltas: &mut Vec<PaneDelta>,
        notif_deltas: &mut Vec<NotifDelta>,
    ) {
        while self.panes.len() > IDENTITY_CAP {
            let pane_id = self
                .panes
                .iter()
                .filter(|(_, pane)| pane.unread.is_empty())
                .min_by(|(left_id, left), (right_id, right)| {
                    (left.read_at.unwrap_or(0), left.latest_event_seq, left_id.as_str()).cmp(&(
                        right.read_at.unwrap_or(0),
                        right.latest_event_seq,
                        right_id.as_str(),
                    ))
                })
                .or_else(|| {
                    self.panes.iter().min_by(|(left_id, left), (right_id, right)| {
                        let left_head = left.unread.front().expect("unread victim has a head");
                        let right_head = right.unread.front().expect("unread victim has a head");
                        (left_head.occurred_at, left_head.seq, left_id.as_str()).cmp(&(
                            right_head.occurred_at,
                            right_head.seq,
                            right_id.as_str(),
                        ))
                    })
                })
                .map(|(id, _)| id.clone())
                .expect("over-cap pane map cannot be empty");
            let evicted_unread =
                self.panes.get(&pane_id).is_some_and(|pane| !pane.unread.is_empty());
            self.panes.remove(&pane_id);
            if evicted_unread {
                tracing::warn!(pane_id, "[identity-evict] evicting live unread pane identity");
            }
            upsert_pane_delta(pane_deltas, PaneDelta::removed(&pane_id));
        }

        while self.notifs.len() > IDENTITY_CAP {
            let notif_id = self
                .notifs
                .iter()
                .filter(|(_, notif)| notif.read)
                .min_by(|(left_id, left), (right_id, right)| {
                    (left.read_at.unwrap_or(0), left.event_seq, left_id.as_str()).cmp(&(
                        right.read_at.unwrap_or(0),
                        right.event_seq,
                        right_id.as_str(),
                    ))
                })
                .or_else(|| {
                    self.notifs.iter().min_by(|(left_id, left), (right_id, right)| {
                        (left.occurred_at, left.event_seq, left_id.as_str()).cmp(&(
                            right.occurred_at,
                            right.event_seq,
                            right_id.as_str(),
                        ))
                    })
                })
                .map(|(id, _)| id.clone())
                .expect("over-cap notification map cannot be empty");
            let evicted_unread = self.notifs.get(&notif_id).is_some_and(|notif| !notif.read);
            self.notifs.remove(&notif_id);
            if evicted_unread {
                tracing::warn!(
                    notif_id,
                    "[identity-evict] evicting live unread notification identity"
                );
            }
            upsert_notif_delta(notif_deltas, NotifDelta::removed(&notif_id));
        }
    }

    fn pane_delta(&self, pane_id: &str) -> PaneDelta {
        let pane = &self.panes[pane_id];
        PaneDelta {
            pane_id: pane_id.to_owned(),
            latest_event_seq: Some(pane.latest_event_seq),
            read_through_seq: Some(pane.read_through_seq),
            first_unread_at: pane.unread.front().map(|event| event.occurred_at),
            severity: pane.unread.iter().map(|event| event.severity).max(),
            removed: None,
        }
    }

    fn notif_delta(&self, notif_id: &str) -> NotifDelta {
        NotifDelta {
            notif_id: notif_id.to_owned(),
            read: Some(self.notifs[notif_id].read),
            removed: None,
        }
    }

    fn delta(&self, revision: u64, panes: Vec<PaneDelta>, notifs: Vec<NotifDelta>) -> StateDelta {
        StateDelta { epoch: self.epoch.clone(), revision, panes, notifs }
    }

    fn finish_delta(
        &mut self,
        panes: Vec<PaneDelta>,
        notifs: Vec<NotifDelta>,
    ) -> Option<StateDelta> {
        if panes.is_empty() && notifs.is_empty() {
            return None;
        }
        let revision = self.bump_revision();
        Some(self.delta(revision, panes, notifs))
    }

    fn take_event_seq(&mut self) -> u64 {
        let event_seq = self.next_event_seq;
        self.next_event_seq = self.next_event_seq.checked_add(1).expect("event sequence exhausted");
        event_seq
    }

    fn take_dedup_generation(&mut self) -> u64 {
        let generation = self.next_dedup_generation;
        self.next_dedup_generation = self
            .next_dedup_generation
            .checked_add(1)
            .expect("dedup reservation generation exhausted");
        generation
    }

    fn bump_revision(&mut self) -> u64 {
        self.revision = self.revision.checked_add(1).expect("attention revision exhausted");
        self.revision
    }
}

impl Default for AttentionLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl PaneDelta {
    fn removed(pane_id: &str) -> Self {
        Self {
            pane_id: pane_id.to_owned(),
            latest_event_seq: None,
            read_through_seq: None,
            first_unread_at: None,
            severity: None,
            removed: Some(true),
        }
    }
}

impl NotifDelta {
    fn removed(notif_id: &str) -> Self {
        Self { notif_id: notif_id.to_owned(), read: None, removed: Some(true) }
    }
}

fn is_expired(start: u64, duration: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(start) >= duration
}

fn upsert_pane_delta(deltas: &mut Vec<PaneDelta>, delta: PaneDelta) {
    if let Some(existing) = deltas.iter_mut().find(|existing| existing.pane_id == delta.pane_id) {
        *existing = delta;
    } else {
        deltas.push(delta);
    }
}

fn upsert_notif_delta(deltas: &mut Vec<NotifDelta>, delta: NotifDelta) {
    if let Some(existing) = deltas.iter_mut().find(|existing| existing.notif_id == delta.notif_id) {
        *existing = delta;
    } else {
        deltas.push(delta);
    }
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_owned());
    }
}

#[cfg(test)]
mod tests {
    //! Blocking-waiter semantics belong to the integration layer and are not tested here.

    use super::*;

    fn ledger() -> AttentionLedger {
        AttentionLedger::with_epoch("epoch-a".into())
    }

    fn pane(id: &str, seq: u64) -> (String, u64) {
        (id.into(), seq)
    }

    #[test]
    fn first_event_and_same_pane_keep_exact_first_unread_at() {
        let mut ledger = ledger();
        ledger.record_pane_event("p", 100, Severity::Info, 100);
        ledger.record_pane_event("p", 250, Severity::Urgent, 250);
        assert_eq!(ledger.first_unread_at("p"), Some(100));
        assert_eq!(ledger.panes["p"].unread.len(), 2);
    }

    #[test]
    fn watermark_pop_is_exact_and_stale_receipt_cannot_clear_newer() {
        let mut ledger = ledger();
        let (first, _) = ledger.record_pane_event("p", 100, Severity::Info, 100);
        let (second, _) = ledger.record_pane_event("p", 200, Severity::Warning, 200);
        let (third, _) = ledger.record_pane_event("p", 300, Severity::Error, 300);
        let epoch = ledger.epoch.clone();

        let (delta, _, _) = ledger.mark_read(&epoch, &[pane("p", second)], &[], 400);
        assert!(delta.is_some());
        assert_eq!(ledger.first_unread_at("p"), Some(300));
        assert_eq!(ledger.panes["p"].read_through_seq, second);

        let (delta, results, applied) = ledger.mark_read(&epoch, &[pane("p", first)], &[], 500);
        assert!(delta.is_none());
        assert_eq!(results[0].status, TargetStatus::Applied);
        assert_eq!(applied, Some(ledger.revision));
        assert_eq!(ledger.panes["p"].unread.front().map(|event| event.seq), Some(third));
    }

    #[test]
    fn union_of_reads_uses_max_watermark_and_replay_is_idempotent() {
        let mut ledger = ledger();
        let (_, _) = ledger.record_pane_event("p", 10, Severity::Info, 10);
        let (second, _) = ledger.record_pane_event("p", 20, Severity::Info, 20);
        let (third, _) = ledger.record_pane_event("p", 30, Severity::Info, 30);
        let epoch = ledger.epoch.clone();
        ledger.mark_read(&epoch, &[pane("p", second)], &[], 40);
        ledger.mark_read(&epoch, &[pane("p", third)], &[], 50);
        let revision = ledger.revision;
        let (delta, result, applied) = ledger.mark_read(&epoch, &[pane("p", second)], &[], 60);
        assert!(delta.is_none());
        assert_eq!(result[0].status, TargetStatus::Applied);
        assert_eq!(applied, Some(revision));
        assert_eq!(ledger.panes["p"].read_through_seq, third);
    }

    #[test]
    fn invalid_watermark_is_rejected_not_clamped_per_target() {
        let mut ledger = ledger();
        let (latest, _) = ledger.record_pane_event("p", 10, Severity::Info, 10);
        let epoch = ledger.epoch.clone();
        let (delta, results, applied) =
            ledger.mark_read(&epoch, &[pane("p", latest + 1), pane("missing", 1)], &[], 20);
        assert!(delta.is_none());
        assert_eq!(results[0].status, TargetStatus::Invalid);
        assert_eq!(results[1].status, TargetStatus::NotFound);
        assert_eq!(applied, None);
        assert_eq!(ledger.panes["p"].read_through_seq, 0);
    }

    #[test]
    fn foreign_epoch_is_stale_and_new_epoch_starts_empty() {
        let mut ledger = ledger();
        ledger.record_pane_event("p", 10, Severity::Info, 10);
        let (delta, results, applied) =
            ledger.mark_read("epoch-b", &[pane("p", 1)], &["n".into()], 20);
        assert!(delta.is_none());
        assert!(results.iter().all(|result| result.status == TargetStatus::StaleEpoch));
        assert_eq!(applied, None);
        let reset = AttentionLedger::with_epoch("epoch-b".into());
        assert!(reset.panes.is_empty());
        assert_eq!(reset.revision, 0);
    }

    #[test]
    fn snapshot_matches_state_and_revisions_are_monotonic() {
        let mut ledger = ledger();
        let (_, first) = ledger.record_pane_event("p", 10, Severity::Warning, 10);
        let (_, second) = ledger.record_notif_event("n", 20, Severity::Error, 20);
        let snapshot = ledger.snapshot();
        assert!(first.revision < second.revision);
        assert_eq!(snapshot.revision, second.revision);
        assert_eq!(snapshot.panes, vec![ledger.pane_delta("p")]);
        assert_eq!(snapshot.notifs, vec![ledger.notif_delta("n")]);

        let json = serde_json::to_value(snapshot).unwrap();
        assert_eq!(json["revision"], "2");
        assert_eq!(json["panes"][0]["latestEventSeq"], "1");
    }

    #[test]
    fn ingest_gate_table_covers_every_source_and_rule_predicate() {
        let mut cfg = NotificationConfig::default();
        assert_eq!(
            evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate: false }),
            IngestGateResult::Accepted
        );
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate: true }),
            IngestGateResult::Suppressed(_)
        ));
        assert_eq!(evaluate_ingest_gate(&cfg, IngestSource::OscNotify), IngestGateResult::Accepted);
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::CommandComplete { matched_rule: true }),
            IngestGateResult::Suppressed(_)
        ));
        cfg.command_complete.enabled = true;
        assert_eq!(
            evaluate_ingest_gate(&cfg, IngestSource::CommandComplete { matched_rule: true }),
            IngestGateResult::Accepted
        );
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::CommandComplete { matched_rule: false }),
            IngestGateResult::Suppressed(_)
        ));
        assert_eq!(
            evaluate_ingest_gate(&cfg, IngestSource::KeywordMatch { matched_rule: true }),
            IngestGateResult::Accepted
        );
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::KeywordMatch { matched_rule: false }),
            IngestGateResult::Suppressed(_)
        ));
        assert_eq!(evaluate_ingest_gate(&cfg, IngestSource::Plugin), IngestGateResult::Accepted);

        cfg.osc_notify = false;
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::OscNotify),
            IngestGateResult::Suppressed(_)
        ));
        cfg.bell.enabled = false;
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::Bell { debounce_duplicate: false }),
            IngestGateResult::Suppressed(_)
        ));
        cfg.enabled = false;
        assert!(matches!(
            evaluate_ingest_gate(&cfg, IngestSource::Plugin),
            IngestGateResult::Suppressed(_)
        ));
    }

    #[test]
    fn plugin_target_models_are_distinct() {
        let mut ledger = ledger();
        ledger.record_notif_event("plugin-notif", 10, Severity::Info, 10);
        ledger.record_pane_event("plugin-pane", 20, Severity::Success, 20);
        assert!(ledger.notifs.contains_key("plugin-notif"));
        assert!(!ledger.notifs.contains_key("plugin-pane"));
        assert!(ledger.panes.contains_key("plugin-pane"));
    }

    #[test]
    fn fully_read_entries_are_garbage_collected_after_retention() {
        let mut ledger = ledger();
        let (seq, _) = ledger.record_pane_event("p", 1, Severity::Info, 1);
        ledger.record_notif_event("n", 1, Severity::Info, 1);
        let epoch = ledger.epoch.clone();
        ledger.mark_read(&epoch, &[pane("p", seq)], &["n".into()], 10);
        let delta = ledger.sweep(10 + UNREAD_TTL).unwrap();
        assert!(ledger.panes.is_empty());
        assert!(ledger.notifs.is_empty());
        assert_eq!(delta.panes[0].removed, Some(true));
        assert_eq!(delta.notifs[0].removed, Some(true));
    }

    #[test]
    fn unread_cap_drops_oldest_and_keeps_exact_next_head() {
        let mut ledger = ledger();
        for index in 0..=UNREAD_CAP {
            ledger.record_pane_event("p", index as u64, Severity::Info, index as u64);
        }
        assert_eq!(ledger.panes["p"].unread.len(), UNREAD_CAP);
        assert_eq!(ledger.first_unread_at("p"), Some(1));
    }

    #[test]
    fn unread_ttl_transitions_pane_and_notif_to_read() {
        let mut ledger = ledger();
        let (seq, _) = ledger.record_pane_event("p", 10, Severity::Info, 10);
        ledger.record_notif_event("n", 10, Severity::Info, 10);
        let delta = ledger.sweep(10 + UNREAD_TTL).unwrap();
        assert_eq!(ledger.panes["p"].read_through_seq, seq);
        assert!(ledger.panes["p"].unread.is_empty());
        assert!(ledger.notifs["n"].read);
        assert_eq!(delta.panes.len(), 1);
        assert_eq!(delta.notifs.len(), 1);
    }

    #[test]
    fn identity_cap_mixed_state_evicts_fully_read_first_even_pre_ttl() {
        let mut ledger = ledger();
        let (seq, _) = ledger.record_pane_event("read-me", 50, Severity::Info, 50);
        let epoch = ledger.epoch.clone();
        ledger.mark_read(&epoch, &[pane("read-me", seq)], &[], 1_000);
        for index in 0..(IDENTITY_CAP - 1) {
            ledger.record_pane_event(
                format!("live-{index}"),
                index as u64 + 100,
                Severity::Info,
                index as u64 + 100,
            );
        }
        ledger.record_pane_event("new-live", 2_000, Severity::Info, 2_000);
        assert!(!ledger.panes.contains_key("read-me"));
        assert!(ledger.panes.contains_key("live-0"));
        assert!(ledger.panes.contains_key("new-live"));
        assert_eq!(ledger.panes.len(), IDENTITY_CAP);
    }

    #[test]
    fn all_unread_identity_cap_evicts_oldest_first_unread() {
        let mut ledger = ledger();
        for index in 0..=IDENTITY_CAP {
            ledger.record_pane_event(format!("p-{index}"), 10, Severity::Info, 10);
        }
        assert!(!ledger.panes.contains_key("p-0"));
        assert_eq!(ledger.panes.len(), IDENTITY_CAP);
    }

    #[test]
    fn unread_notif_identity_cap_breaks_timestamp_ties_by_event_sequence() {
        let mut ledger = ledger();
        for index in 0..=IDENTITY_CAP {
            ledger.record_notif_event(format!("n-{index}"), 10, Severity::Info, 10);
        }
        assert!(!ledger.notifs.contains_key("n-0"));
        assert!(ledger.notifs.contains_key(&format!("n-{IDENTITY_CAP}")));
        assert_eq!(ledger.notifs.len(), IDENTITY_CAP);
    }

    #[test]
    fn mutation_touch_expiry_is_folded_into_each_mutations_single_delta() {
        let mut pane_record = ledger();
        pane_record.record_pane_event("expired-pane", 0, Severity::Info, 0);
        pane_record.record_notif_event("expired-notif", 0, Severity::Info, 0);
        let before = pane_record.revision;
        let (_, delta) =
            pane_record.record_pane_event("fresh-pane", UNREAD_TTL, Severity::Success, UNREAD_TTL);
        assert_eq!(delta.revision, before + 1);
        assert_eq!(delta.panes.len(), 2);
        assert_eq!(delta.notifs.len(), 1);
        assert!(pane_record.panes["expired-pane"].unread.is_empty());
        assert!(pane_record.notifs["expired-notif"].read);

        let mut notif_record = ledger();
        notif_record.record_pane_event("expired-pane", 0, Severity::Info, 0);
        let before = notif_record.revision;
        let (_, delta) = notif_record.record_notif_event(
            "fresh-notif",
            UNREAD_TTL,
            Severity::Success,
            UNREAD_TTL,
        );
        assert_eq!(delta.revision, before + 1);
        assert_eq!(delta.panes.len(), 1);
        assert_eq!(delta.notifs.len(), 1);

        let mut mark_read = ledger();
        mark_read.record_notif_event("expired-notif", 0, Severity::Info, 0);
        let (seq, _) = mark_read.record_pane_event("live-pane", 1, Severity::Info, 1);
        let epoch = mark_read.epoch.clone();
        let before = mark_read.revision;
        let (delta, _, applied) =
            mark_read.mark_read(&epoch, &[pane("live-pane", seq)], &[], UNREAD_TTL);
        let delta = delta.unwrap();
        assert_eq!(delta.revision, before + 1);
        assert_eq!(applied, Some(delta.revision));
        assert_eq!(delta.panes.len(), 1);
        assert_eq!(delta.notifs.len(), 1);

        let mut pane_close = ledger();
        pane_close.record_notif_event("expired-notif", 0, Severity::Info, 0);
        pane_close.record_pane_event("closing-pane", 1, Severity::Info, 1);
        let before = pane_close.revision;
        let delta = pane_close.pane_closed("closing-pane", UNREAD_TTL).unwrap();
        assert_eq!(delta.revision, before + 1);
        assert_eq!(delta.panes, vec![PaneDelta::removed("closing-pane")]);
        assert_eq!(delta.notifs.len(), 1);
    }

    #[test]
    fn pane_close_emits_removal_delta() {
        let mut ledger = ledger();
        ledger.record_pane_event("p", 10, Severity::Info, 10);
        let delta = ledger.pane_closed("p", 11).unwrap();
        assert_eq!(delta.panes, vec![PaneDelta::removed("p")]);
        assert!(!ledger.panes.contains_key("p"));
        assert!(ledger.pane_closed("p", 12).is_none());
    }

    fn suppressed(reason: &str) -> DedupOutcome {
        DedupOutcome::Producer(ProducerOutcome::Suppressed { reason: reason.into() })
    }

    fn key(client_id: &str, request_id: &str) -> (String, String) {
        (client_id.into(), request_id.into())
    }

    fn generation(result: ReserveResult) -> u64 {
        match result {
            ReserveResult::Reserved { generation } => generation,
            other => panic!("expected reservation, got {other:?}"),
        }
    }

    #[test]
    fn dedup_in_flight_replay_and_conflict_state_machine() {
        let mut ledger = ledger();
        let generation = generation(ledger.reserve("c", "r", 7, 100));
        assert_eq!(ledger.reserve("c", "r", 7, 101), ReserveResult::InFlight);
        assert_eq!(ledger.reserve("c", "r", 8, 101), ReserveResult::Conflict);
        let outcome = suppressed("disabled");
        assert!(ledger.complete(&key("c", "r"), generation, outcome.clone(), 200));
        assert_eq!(ledger.reserve("c", "r", 7, 201), ReserveResult::Replay(outcome));
    }

    #[test]
    fn reservation_timeout_reclaims_zombie_without_permanent_block() {
        let mut ledger = ledger();
        let first = generation(ledger.reserve("c", "r", 7, 100));
        assert_eq!(
            ledger.reserve("c", "r", 7, 100 + RESERVATION_TIMEOUT - 1),
            ReserveResult::InFlight
        );
        let second = generation(ledger.reserve("c", "r", 8, 100 + RESERVATION_TIMEOUT));
        assert_ne!(first, second);
        assert_eq!(ledger.dedup.len(), 1);
    }

    #[test]
    fn dedup_ttl_starts_at_done_time_and_never_evicts_in_flight_early() {
        let mut ledger = ledger();
        ledger.reserve("c", "in-flight", 1, 0);
        let generation = generation(ledger.reserve("c", "done", 2, 0));
        ledger.complete(&key("c", "done"), generation, suppressed("x"), 1_000);
        ledger.sweep(DEDUP_TTL);
        assert!(ledger.dedup.contains_key(&("c".into(), "done".into())));
        assert!(!ledger.dedup.contains_key(&("c".into(), "in-flight".into())));
        ledger.sweep(1_000 + DEDUP_TTL);
        assert!(!ledger.dedup.contains_key(&("c".into(), "done".into())));
    }

    #[test]
    fn suppressed_outcome_is_cached_across_settings_change() {
        let mut ledger = ledger();
        let mut cfg = NotificationConfig::default();
        cfg.enabled = false;
        let gate = evaluate_ingest_gate(&cfg, IngestSource::Plugin);
        assert!(matches!(gate, IngestGateResult::Suppressed(_)));
        let generation = generation(ledger.reserve("c", "r", 1, 0));
        let outcome = suppressed("notification_disabled");
        ledger.complete(&key("c", "r"), generation, outcome.clone(), 1);
        cfg.enabled = true;
        assert_eq!(evaluate_ingest_gate(&cfg, IngestSource::Plugin), IngestGateResult::Accepted);
        assert_eq!(ledger.reserve("c", "r", 1, 2), ReserveResult::Replay(outcome));
    }

    #[test]
    fn multi_pane_batch_uses_one_revision_and_one_delta() {
        let mut ledger = ledger();
        let (a, _) = ledger.record_pane_event("a", 10, Severity::Info, 10);
        let (b, _) = ledger.record_pane_event("b", 20, Severity::Info, 20);
        let epoch = ledger.epoch.clone();
        let before = ledger.revision;
        let (delta, results, applied) =
            ledger.mark_read(&epoch, &[pane("a", a), pane("b", b)], &[], 30);
        let delta = delta.unwrap();
        assert_eq!(ledger.revision, before + 1);
        assert_eq!(delta.revision, ledger.revision);
        assert_eq!(applied, Some(ledger.revision));
        assert_eq!(delta.panes.len(), 2);
        assert!(results.iter().all(|result| result.status == TargetStatus::Applied));
    }

    #[test]
    fn detached_style_reserved_mutation_can_commit_and_install_outcome() {
        let mut ledger = ledger();
        let generation = generation(ledger.reserve("c", "r", 1, 0));
        let (seq, delta) = ledger.record_pane_event("p", 10, Severity::Info, 10);
        let outcome = DedupOutcome::Producer(ProducerOutcome::AcceptedPane {
            pane_id: "p".into(),
            event_seq: seq,
            revision: delta.revision,
        });
        assert!(ledger.complete(&key("c", "r"), generation, outcome.clone(), 11));
        assert_eq!(ledger.reserve("c", "r", 1, 12), ReserveResult::Replay(outcome));
        assert_eq!(ledger.panes["p"].latest_event_seq, seq);
    }

    #[test]
    fn stale_owner_completion_after_reclaim_is_rejected_without_mutation() {
        let mut ledger = ledger();
        let old_generation = generation(ledger.reserve("c", "r", 1, 100));
        let new_generation = generation(ledger.reserve("c", "r", 2, 100 + RESERVATION_TIMEOUT));
        let reclaimed_entry = ledger.dedup[&key("c", "r")].clone();

        assert!(!ledger.complete(&key("c", "r"), old_generation, suppressed("stale"), 200));
        assert_eq!(ledger.dedup[&key("c", "r")], reclaimed_entry);

        let outcome = suppressed("fresh");
        assert!(ledger.complete(&key("c", "r"), new_generation, outcome.clone(), 201));
        assert_eq!(ledger.reserve("c", "r", 2, 202), ReserveResult::Replay(outcome));
    }

    #[test]
    fn completion_cannot_overwrite_already_done_entry() {
        let mut ledger = ledger();
        let generation = generation(ledger.reserve("c", "r", 1, 0));
        let original = suppressed("original");
        assert!(ledger.complete(&key("c", "r"), generation, original.clone(), 10));
        let done_entry = ledger.dedup[&key("c", "r")].clone();

        assert!(!ledger.complete(&key("c", "r"), generation, suppressed("replacement"), 20));
        assert_eq!(ledger.dedup[&key("c", "r")], done_entry);
        assert_eq!(ledger.reserve("c", "r", 1, 21), ReserveResult::Replay(original));
    }

    #[test]
    fn completed_same_key_different_payload_is_conflict() {
        let mut ledger = ledger();
        let generation = generation(ledger.reserve("c", "r", 1, 0));
        assert!(ledger.complete(&key("c", "r"), generation, suppressed("cached"), 1));
        assert_eq!(ledger.reserve("c", "r", 2, 2), ReserveResult::Conflict);
    }

    #[test]
    fn reclaim_then_fresh_reserve_cycle_completes_and_replays() {
        let mut ledger = ledger();
        let old_generation = generation(ledger.reserve("c", "r", 1, 0));
        let new_generation = generation(ledger.reserve("c", "r", 2, RESERVATION_TIMEOUT));
        assert_ne!(old_generation, new_generation);

        let outcome = suppressed("new-owner");
        assert!(ledger.complete(&key("c", "r"), new_generation, outcome.clone(), 31_000));
        assert_eq!(ledger.reserve("c", "r", 2, 31_001), ReserveResult::Replay(outcome));
    }

    #[test]
    fn accepted_outcome_variants_preserve_exact_wire_shape() {
        let pane = serde_json::to_value(ProducerOutcome::AcceptedPane {
            pane_id: "p".into(),
            event_seq: 7,
            revision: 8,
        })
        .unwrap();
        assert_eq!(
            pane,
            serde_json::json!({
                "status": "accepted",
                "paneId": "p",
                "eventSeq": "7",
                "revision": "8"
            })
        );

        let notif = serde_json::to_value(ProducerOutcome::AcceptedNotif {
            notif_id: "n".into(),
            event_seq: 9,
            revision: 10,
        })
        .unwrap();
        assert_eq!(
            notif,
            serde_json::json!({
                "status": "accepted",
                "notifId": "n",
                "eventSeq": "9",
                "revision": "10"
            })
        );
    }
}
