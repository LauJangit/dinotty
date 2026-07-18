import { authFetch, apiUrl } from './apiBase'
import type { Workspace } from '../types/workspace'

async function ensureOk(res: Response) {
  if (res.ok) return
  let message = res.statusText
  try {
    const data = await res.json()
    message = data?.error || message
  } catch {
    /* use status text */
  }
  throw new Error(message || `HTTP ${res.status}`)
}

export async function apiListWorkspaces(): Promise<Workspace[]> {
  const res = await authFetch(apiUrl('/api/workspaces'))
  await ensureOk(res)
  const data = await res.json()
  return data.workspaces ?? []
}

export async function apiCreateWorkspace(
  path: string,
  name?: string,
  connectionId?: string,
  overrides?: { abbr?: string; color?: string }
): Promise<Workspace> {
  const res = await authFetch(apiUrl('/api/workspaces'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      name,
      connection_id: connectionId,
      abbr: overrides?.abbr,
      color: overrides?.color,
    }),
  })
  await ensureOk(res)
  return res.json()
}

export async function apiUpdateWorkspace(
  id: string,
  data: { name?: string; path?: string; connection_id?: string; abbr?: string; color?: string }
): Promise<Workspace> {
  const res = await authFetch(apiUrl(`/api/workspaces/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  await ensureOk(res)
  return res.json()
}

export async function apiDeleteWorkspace(id: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/workspaces/${id}`), { method: 'DELETE' })
  await ensureOk(res)
}

export async function apiActivateWorkspace(id: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/workspaces/${id}/activate`), { method: 'PUT' })
  await ensureOk(res)
}

export async function apiDeactivateWorkspace(): Promise<void> {
  const res = await authFetch(apiUrl('/api/workspaces/active'), { method: 'DELETE' })
  await ensureOk(res)
}

export async function apiReorderWorkspaces(ids: string[]): Promise<void> {
  const res = await authFetch(apiUrl('/api/workspaces/reorder'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  await ensureOk(res)
}
