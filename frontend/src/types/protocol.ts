export interface InputMsg {
  type: 'input'
  data: string
}

export interface ResizeMsg {
  type: 'resize'
  cols: number
  rows: number
}

/// Client → server: after Reconnected, the client converges its layout, fits
/// once, and sends SnapshotRequest{cols, rows}. Server replies with
/// ReplayBegin → scrollback+snapshot chunks → ReplayEnd, and applies PTY
/// resize to (cols, rows) atomically with the snapshot. Replaces the legacy
/// flow where the server pushed a snapshot at stale session.size immediately
/// on connect, which the client's fit-ladder could interrupt mid-write and
/// cause absolute-row addressing to clamp/wrap to wrong dimensions.
export interface SnapshotRequestMsg {
  type: 'snapshot_request'
  cols: number
  rows: number
}

export type ClientMsg = InputMsg | ResizeMsg | SnapshotRequestMsg

export interface OutputMsg {
  type: 'output'
  data: string
}

export interface ShellInfoMsg {
  type: 'shell_info'
  shell_type: string
}

export interface ReconnectedMsg {
  type: 'reconnected'
  cols: number
  rows: number
}

export interface ResizeServerMsg {
  type: 'resize'
  cols: number
  rows: number
}

export interface SessionExitMsg {
  type: 'session_exit'
  pane_id: string
}

/// DEC mode 2026 transaction boundary. SyncBegin precedes buffered Output
/// accumulated during synchronized output mode; SyncEnd follows the flushed
/// Output. Frontend diverts Output into a transaction buffer between
/// SyncBegin and SyncEnd, then writes the merged buffer to xterm as a single
/// batch — eliminating per-chunk rAF repaints during a synchronized redraw.
export interface SyncBeginMsg {
  type: 'sync_begin'
}

export interface SyncEndMsg {
  type: 'sync_end'
}

/// Server → client: replay transaction boundary (fit-then-snapshot handshake).
/// ReplayBegin precedes scrollback+snapshot chunks generated at the client's
/// requested size; ReplayEnd follows them. Frontend diverts Output into the
/// transaction buffer during replay (same mechanism as SyncBegin/End) and
/// writes the merged buffer to xterm as a single batch on ReplayEnd. Cols/rows
/// carry the dimensions the snapshot was encoded at — client compares to its
/// current wrapper size and re-requests on mismatch.
export interface ReplayBeginMsg {
  type: 'replay_begin'
  cols: number
  rows: number
}

export interface ReplayEndMsg {
  type: 'replay_end'
}

export type ServerMsg =
  | OutputMsg
  | ShellInfoMsg
  | ReconnectedMsg
  | ResizeServerMsg
  | SessionExitMsg
  | SyncBeginMsg
  | SyncEndMsg
  | ReplayBeginMsg
  | ReplayEndMsg

// Sync WS messages
export interface SyncTabList {
  type: 'tab_list'
  tabs: {
    tab_id: string
    pane_id: string
    layout?: any
    active_pane_id?: string
    cwd?: string
    connection_id?: string
  }[]
  active_pane_id: string | null
}

export interface SyncTabCreated {
  type: 'tab_created'
  tab_id: string
  pane_id: string
  layout?: any
  cwd?: string
  connection_id?: string
}

export interface SyncTabClosed {
  type: 'tab_closed'
  pane_id: string
}

export interface SyncTabActivated {
  type: 'tab_activated'
  pane_id: string
}

export interface SyncPluginChanged {
  type: 'plugin_changed'
  plugin_id: string
  change: string
}

export interface SyncLayoutUpdated {
  type: 'layout_updated'
  pane_id: string
  layout: any
  active_pane_id: string
}

export interface SyncSshAuthPrompt {
  type: 'ssh_auth_prompt'
  pane_id: string
  prompts: Array<{ prompt: string; echo: boolean }>
}

export interface SyncWorkspaceCreated {
  type: 'workspace_created'
  workspace: { id: string; name: string; path: string; order: number; connection_id?: string; abbr?: string; color?: string }
}

export interface SyncWorkspaceUpdated {
  type: 'workspace_updated'
  workspace: { id: string; name: string; path: string; order: number; connection_id?: string; abbr?: string; color?: string }
}

export interface SyncWorkspaceDeleted {
  type: 'workspace_deleted'
  id: string
}

export interface SyncWorkspaceActivated {
  type: 'workspace_activated'
  id: string | null
}

export interface SyncWorkspaceReordered {
  type: 'workspace_reordered'
  ids: string[]
}

export interface SyncWorkspaceList {
  type: 'workspace_list'
  workspaces: { id: string; name: string; path: string; order: number; connection_id?: string; abbr?: string; color?: string }[]
  active_workspace_id: string | null
}

export interface SyncCreateTab {
  type: 'create_tab'
  layout: any
  tab_id?: string
  pane_id?: string
}

export interface SyncCloseTab {
  type: 'close_tab'
  pane_id: string
}

export interface SyncClosePane {
  type: 'close_pane'
  pane_id: string
}

export interface SyncActivateTab {
  type: 'activate_tab'
  pane_id: string
}

export interface SyncUpdateLayout {
  type: 'update_layout'
  pane_id: string
  layout: any
  active_pane_id: string
}

export interface SyncSshAuthResponse {
  type: 'ssh_auth_response'
  pane_id: string
  responses: string[]
}

export interface SyncEvent {
  type: 'event'
  event_name: string
  data: unknown
  source_pane_id?: string
  plugin_id?: string
  target_plugin_id?: string
}

export interface SyncHello {
  type: 'sync_hello'
  client_id: string
}

export interface SyncBell {
  type: 'bell'
  v: number
  pane_id: string
  title?: string
  body: string
  notification_type: string
  eventSeq: string
  occurredAt: number
  severity: 'info' | 'success' | 'warning' | 'error' | 'urgent'
  notifId?: string
}

export interface SyncNotify {
  type: 'notify'
  v: number
  pane_id: string
  title?: string
  body: string
  notification_type: string
  eventSeq: string
  occurredAt: number
  severity: 'info' | 'success' | 'warning' | 'error' | 'urgent'
  notifId?: string
}

export interface SyncStateDelta {
  type: 'state_delta'
  epoch: string
  revision: string
  panes: Array<{
    paneId: string
    latestEventSeq: string | null
    readThroughSeq: string | null
    firstUnreadAt: number | null
    severity: string | null
    removed?: true
  }>
  notifs: Array<{
    notifId: string
    read: boolean | null
    removed?: true
  }>
}

export interface SyncSnapshot {
  type: 'snapshot'
  epoch: string
  revision: string
  panes: Array<{
    paneId: string
    latestEventSeq: string | null
    readThroughSeq: string | null
    firstUnreadAt: number | null
    severity: string | null
    removed?: true
  }>
  notifs: Array<{
    notifId: string
    read: boolean | null
    removed?: true
  }>
}

export interface SyncMarkReadResult {
  type: 'mark_read_result'
  requestId: string
  epoch: string
  appliedAtRevision: string | null
  results: Array<{
    target: { paneId: string } | { notifId: string }
    status: 'applied' | 'stale_epoch' | 'invalid' | 'not_found' | 'conflict'
  }>
}

export interface SyncResyncRequired {
  type: 'resync_required'
  v: number
}

export interface SyncSuggestions {
  type: 'suggestions'
  items: Array<{ command: string; frequency: number }>
}

export interface SyncMonitorData {
  type: 'monitor_data'
  data: Record<string, unknown>
}

export interface SyncMonitorHistory {
  type: 'monitor_history'
  data: Record<string, unknown>[]
}

export type SyncServerMsg =
  | SyncTabList
  | SyncTabCreated
  | SyncTabClosed
  | SyncTabActivated
  | SyncPluginChanged
  | SyncLayoutUpdated
  | SyncSshAuthPrompt
  | SyncWorkspaceCreated
  | SyncWorkspaceUpdated
  | SyncWorkspaceDeleted
  | SyncWorkspaceActivated
  | SyncWorkspaceReordered
  | SyncWorkspaceList
  | SyncEvent
  | SyncHello
  | SyncBell
  | SyncNotify
  | SyncStateDelta
  | SyncSnapshot
  | SyncMarkReadResult
  | SyncResyncRequired
  | SyncSuggestions
  | SyncMonitorData
  | SyncMonitorHistory

export interface SyncMarkRead {
  type: 'mark_read'
  v: number
  epoch: string
  clientId: string
  requestId: string
  reason:
    | 'focus'
    | 'terminal_input'
    | 'tab_activate'
    | 'tab_close'
    | 'pane_close'
    | 'goto'
    | 'active_observed'
    | 'dismiss'
    | 'clear_all'
  panes: Array<{ paneId: string; throughEventSeq: string }>
  notifs: Array<{ notifId: string }>
}

export type SyncClientMsg =
  | SyncCreateTab
  | SyncCloseTab
  | SyncClosePane
  | SyncActivateTab
  | SyncUpdateLayout
  | SyncSshAuthResponse
  | SyncMarkRead
