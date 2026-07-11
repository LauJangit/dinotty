import { authFetch, apiUrl } from './apiBase'
import type { Workspace } from '../types/workspace'

export async function apiListWorkspaces(): Promise<Workspace[]> {
  const res = await authFetch(apiUrl('/api/workspaces'))
  const data = await res.json()
  return data.workspaces ?? []
}

export async function apiCreateWorkspace(
  path: string,
  name?: string,
  connectionId?: string
): Promise<Workspace> {
  const res = await authFetch(apiUrl('/api/workspaces'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name, connection_id: connectionId }),
  })
  return res.json()
}

export async function apiUpdateWorkspace(
  id: string,
  data: { name?: string; path?: string; connection_id?: string }
): Promise<Workspace> {
  const res = await authFetch(apiUrl(`/api/workspaces/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function apiDeleteWorkspace(id: string): Promise<void> {
  await authFetch(apiUrl(`/api/workspaces/${id}`), { method: 'DELETE' })
}

export async function apiActivateWorkspace(id: string): Promise<void> {
  await authFetch(apiUrl(`/api/workspaces/${id}/activate`), { method: 'PUT' })
}

export async function apiDeactivateWorkspace(): Promise<void> {
  await authFetch(apiUrl('/api/workspaces/active'), { method: 'DELETE' })
}

export async function apiReorderWorkspaces(ids: string[]): Promise<void> {
  await authFetch(apiUrl('/api/workspaces/reorder'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}
