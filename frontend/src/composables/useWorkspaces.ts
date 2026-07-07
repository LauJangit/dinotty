import { ref, computed } from 'vue'
import type { Workspace } from '../types/workspace'
import type { TerminalTab } from '../types/pane'
import {
  apiListWorkspaces,
  apiCreateWorkspace,
  apiUpdateWorkspace,
  apiDeleteWorkspace,
  apiActivateWorkspace,
  apiDeactivateWorkspace,
  apiReorderWorkspaces,
} from './useWorkspaceApi'

const workspaces = ref<Workspace[]>([])
const activeWorkspaceId = ref<string | null>(null)

export function useWorkspaces() {
  async function loadWorkspaces() {
    try {
      workspaces.value = await apiListWorkspaces()
    } catch (e) {
      console.error('Failed to load workspaces:', e)
    }
  }

  async function createWorkspace(path: string, name?: string) {
    const ws = await apiCreateWorkspace(path, name)
    // Optimistic add; sync will reconcile if needed
    if (!workspaces.value.find((w) => w.id === ws.id)) {
      workspaces.value.push(ws)
    }
    return ws
  }

  async function updateWorkspace(id: string, data: Partial<Workspace>) {
    const ws = await apiUpdateWorkspace(id, data)
    const idx = workspaces.value.findIndex((w) => w.id === id)
    if (idx >= 0) workspaces.value[idx] = ws
    return ws
  }

  async function deleteWorkspace(id: string) {
    await apiDeleteWorkspace(id)
    workspaces.value = workspaces.value.filter((w) => w.id !== id)
    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = null
    }
  }

  async function activateWorkspace(id: string | null) {
    if (id) {
      await apiActivateWorkspace(id)
    } else {
      await apiDeactivateWorkspace()
    }
    activeWorkspaceId.value = id
  }

  async function reorderWorkspaces(ids: string[]) {
    await apiReorderWorkspaces(ids)
    // Update local order
    for (let i = 0; i < ids.length; i++) {
      const ws = workspaces.value.find((w) => w.id === ids[i])
      if (ws) ws.order = i
    }
    workspaces.value.sort((a, b) => a.order - b.order)
  }

  /**
   * Match a CWD to the best (longest prefix) workspace.
   * Both cwd and workspace.path are assumed to be canonicalized absolute paths from the backend.
   */
  function matchWorkspace(cwd: string): Workspace | null {
    if (!cwd) return null
    let best: Workspace | null = null
    let bestLen = 0
    for (const ws of workspaces.value) {
      if (cwd === ws.path || (cwd.startsWith(ws.path) && cwd[ws.path.length] === '/')) {
        if (ws.path.length > bestLen) {
          best = ws
          bestLen = ws.path.length
        }
      }
    }
    return best
  }

  /**
   * Filter tabs to only those belonging to the given workspace.
   */
  function filterTabs(tabs: TerminalTab[], workspaceId: string): TerminalTab[] {
    return tabs.filter((tab) => {
      if (!tab.cwd) return false
      const ws = matchWorkspace(tab.cwd)
      return ws?.id === workspaceId
    })
  }

  const activeWorkspacePath = computed(
    () => workspaces.value.find((w) => w.id === activeWorkspaceId.value)?.path
  )

  return {
    workspaces,
    activeWorkspaceId,
    activeWorkspacePath,
    loadWorkspaces,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    activateWorkspace,
    reorderWorkspaces,
    matchWorkspace,
    filterTabs,
  }
}
