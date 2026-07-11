export interface InputMsg {
  type: 'input'
  data: string
}

export interface ResizeMsg {
  type: 'resize'
  cols: number
  rows: number
}

export type ClientMsg = InputMsg | ResizeMsg

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

export type ServerMsg = OutputMsg | ShellInfoMsg | ReconnectedMsg | ResizeServerMsg | SessionExitMsg

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
  workspace: { id: string; name: string; path: string; order: number; connection_id?: string }
}

export interface SyncWorkspaceUpdated {
  type: 'workspace_updated'
  workspace: { id: string; name: string; path: string; order: number; connection_id?: string }
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
  workspaces: { id: string; name: string; path: string; order: number; connection_id?: string }[]
  active_workspace_id: string | null
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

export type SyncClientMsg =
  | SyncCreateTab
  | SyncCloseTab
  | SyncClosePane
  | SyncActivateTab
  | SyncUpdateLayout
  | SyncSshAuthResponse
