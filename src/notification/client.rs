use std::collections::VecDeque;

use tokio::sync::{mpsc, watch};

use crate::attention::AttentionLedger;

use super::protocol::ServerEnvelope;
use super::ConnId;

#[derive(Debug)]
pub(crate) struct QueuedData {
    pub(crate) envelope: ServerEnvelope,
    pub(crate) bytes: usize,
}

#[derive(Debug)]
pub(crate) struct ClientHandle {
    pub(crate) data: VecDeque<QueuedData>,
    pub(crate) data_bytes: usize,
    pub(crate) data_wake: mpsc::Sender<()>,
    pub(crate) control: mpsc::Sender<ServerEnvelope>,
    pub(crate) disconnect: watch::Sender<bool>,
    pub(crate) needs_snapshot: bool,
    pub(crate) resync_enqueued: bool,
    pub(crate) disconnect_requested: bool,
}

#[derive(Debug)]
pub struct ClientRegistration {
    pub conn_id: ConnId,
    pub data_wake: mpsc::Receiver<()>,
    pub control: mpsc::Receiver<ServerEnvelope>,
    pub disconnect: watch::Receiver<bool>,
}

#[derive(Debug)]
pub(crate) struct LedgerHub {
    pub(crate) ledger: AttentionLedger,
    pub(crate) clients: std::collections::HashMap<ConnId, ClientHandle>,
}
