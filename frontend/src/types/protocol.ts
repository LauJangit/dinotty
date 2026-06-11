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

export type ServerMsg = OutputMsg | ShellInfoMsg | ReconnectedMsg

// Sync WS messages
export interface SyncTabList {
  type: 'tab_list'
  tabs: { pane_id: string; layout?: any; active_pane_id?: string }[]
  active_pane_id: string | null
}

export interface SyncTabCreated {
  type: 'tab_created'
  pane_id: string
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

export type SyncServerMsg = SyncTabList | SyncTabCreated | SyncTabClosed | SyncTabActivated | SyncPluginChanged | SyncLayoutUpdated

export interface SyncCreateTab {
  type: 'create_tab'
  pane_id: string
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

export type SyncClientMsg = SyncCreateTab | SyncCloseTab | SyncClosePane | SyncActivateTab | SyncUpdateLayout
