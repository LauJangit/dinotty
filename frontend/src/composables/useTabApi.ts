import { authFetch, apiUrl } from './apiBase'

export interface CreateTabResult {
  tab_id: string
  pane_id: string
  layout: any
}

export interface SplitPaneResult {
  new_pane_id: string
  layout: any
}

export interface ClosePaneResult {
  ok: boolean
  tab_closed: boolean
  layout?: any
  active_pane_id?: string
}

export async function apiCreateTab(): Promise<CreateTabResult> {
  const res = await authFetch(apiUrl('/api/tabs'), { method: 'POST' })
  if (!res.ok) throw new Error(`create tab failed: ${res.status}`)
  return res.json()
}

export async function apiCloseTab(tabId: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}`), { method: 'DELETE' })
  if (!res.ok) throw new Error(`close tab failed: ${res.status}`)
}

export async function apiSplitPane(tabId: string, paneId: string, direction: string): Promise<SplitPaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pane_id: paneId, direction }),
  })
  if (!res.ok) throw new Error(`split pane failed: ${res.status}`)
  return res.json()
}

export async function apiClosePane(tabId: string, paneId: string): Promise<ClosePaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/${paneId}`), { method: 'DELETE' })
  if (!res.ok) throw new Error(`close pane failed: ${res.status}`)
  return res.json()
}

export async function apiActivatePane(tabId: string, paneId: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/${paneId}/activate`), { method: 'PUT' })
  if (!res.ok) throw new Error(`activate pane failed: ${res.status}`)
}

export async function apiUpdateLayout(tabId: string, layout: any, activePaneId: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/layout`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, active_pane_id: activePaneId }),
  })
  if (!res.ok) throw new Error(`update layout failed: ${res.status}`)
}
