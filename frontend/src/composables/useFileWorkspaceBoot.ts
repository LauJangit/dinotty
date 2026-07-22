import type { Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import {
  loadFileWorkspaceState,
  saveFileWorkspaceState,
  type PersistedFileWorkspaceState,
} from './useFileWorkspaceState'
import type { DirEntry } from '../components/workspace/TreeRows'

export interface FileWorkspaceBootOptions {
  paneId: Ref<string>
  visible: Ref<boolean>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  previewErr: Ref<string>
  meta: Ref<any>
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  inlineCreate: Ref<{ parentRel: string; kind: 'file' | 'dir' } | null>
  contextMenu: Ref<any>
  editorLayout: Ref<any>
  activeEditorLeafId: Ref<string | null>
  activeLeaf: Ref<any>
  ensureChildren: (rel: string) => Promise<void>
  onSelectFile: (rel: string) => Promise<void> | void
  onSelectDir: (rel: string) => void
  connectTreeWatchSocket: () => void
  disconnectTreeWatchSocket: () => void
  fetchGitStatus: () => Promise<void>
}

export interface FileWorkspaceBoot {
  reloadAll: () => Promise<void>
  expandFirstLevelDirs: () => Promise<void>
  captureState: () => PersistedFileWorkspaceState
  applyState: (s: PersistedFileWorkspaceState) => void
  boot: () => Promise<void>
  openFromTerminal: (path: string) => Promise<void>
}

export function useFileWorkspaceBoot(opts: FileWorkspaceBootOptions): FileWorkspaceBoot {
  const {
    paneId,
    childCache,
    expanded,
    previewErr,
    meta,
    selectedRel,
    selectedIsDir,
    inlineCreate,
    contextMenu,
    editorLayout,
    activeEditorLeafId,
    activeLeaf,
    ensureChildren,
    onSelectFile,
    onSelectDir,
    connectTreeWatchSocket,
    fetchGitStatus,
  } = opts

  async function reloadAll(): Promise<void> {
    inlineCreate.value = null
    contextMenu.value = null
    childCache.value = {}
    expanded.value = new Set()
    previewErr.value = ''
    meta.value = null
    try {
      await ensureChildren('')
    } catch {
      previewErr.value = 'list failed'
    }
  }

  async function expandFirstLevelDirs(): Promise<void> {
    const entries = childCache.value['']
    if (!entries) return
    const dirs = entries.filter((e) => e.is_dir)
    if (!dirs.length) return
    const dirPaths = dirs.map((d) => d.name)
    expanded.value = new Set(dirPaths)
    await Promise.all(dirPaths.map((p) => ensureChildren(p)))
  }

  function captureState(): PersistedFileWorkspaceState {
    return {
      editorLayout: editorLayout.value,
      activeEditorLeafId: activeEditorLeafId.value,
      childCache: childCache.value,
      expanded: expanded.value,
    }
  }

  function applyState(s: PersistedFileWorkspaceState): void {
    editorLayout.value = s.editorLayout
    activeEditorLeafId.value = s.activeEditorLeafId
    childCache.value = s.childCache
    expanded.value = s.expanded
  }

  async function boot(): Promise<void> {
    const saved = paneId.value ? loadFileWorkspaceState(paneId.value) : undefined
    inlineCreate.value = null
    contextMenu.value = null
    previewErr.value = ''
    if (saved) {
      applyState(saved)
      try {
        connectTreeWatchSocket()
        fetchGitStatus()
      } catch {
        // best-effort
      }
      const leaf = activeLeaf.value
      if (leaf?.filePath && !leaf.isDir) void onSelectFile(leaf.filePath)
      return
    }
    selectedRel.value = null
    selectedIsDir.value = false
    meta.value = null
    childCache.value = {}
    expanded.value = new Set()
    try {
      await ensureChildren('')
      connectTreeWatchSocket()
      fetchGitStatus()
    } catch {
      previewErr.value = 'list failed'
    }
  }

  async function openFromTerminal(path: string): Promise<void> {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: paneId.value, path })
    const res = await authFetch(apiUrl(`/api/workspace/resolve?${q}`))
    if (!res.ok) return
    const { rel } = await res.json()
    previewErr.value = ''
    inlineCreate.value = null
    contextMenu.value = null
    childCache.value = {}
    expanded.value = new Set()
    try {
      await ensureChildren('')
    } catch {
      previewErr.value = 'list failed'
      return
    }
    const parts = (rel as string).split('/').filter(Boolean)
    if (parts.length === 0) {
      selectedRel.value = null
      selectedIsDir.value = false
      meta.value = null
      return
    }
    let acc = ''
    const nextExpanded = new Set(expanded.value)
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      nextExpanded.add(acc)
      await ensureChildren(acc)
    }
    expanded.value = nextExpanded
    const base = parts[parts.length - 1]
    const parentRel = parts.slice(0, -1).join('/')
    await ensureChildren(parentRel)
    const full = rel as string
    const parentEntries = childCache.value[parentRel]
    const entry = parentEntries?.find((e) => e.name === base)
    if (entry?.is_dir) onSelectDir(full)
    else await onSelectFile(full)
  }

  return {
    reloadAll,
    expandFirstLevelDirs,
    captureState,
    applyState,
    boot,
    openFromTerminal,
  }
}

// Re-export for callers that need to persist state on pane switch
export { saveFileWorkspaceState }
