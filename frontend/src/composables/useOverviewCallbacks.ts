import { ref } from 'vue'
import type { Ref } from 'vue'
import { nextTick } from 'vue'
import { apiCreateSshTab } from './useTabApi'
import { ensureSplitRoot } from '../types/pane'
import type { TerminalTab, Tab } from '../types/pane'

export interface OverviewCallbacksOptions {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  activeWorkspaceId: Ref<string | null>
  termRefs: Record<string, { focus: () => void }>
  session: {
    renameTab: (tabId: string, title: string) => void
  }
  activateTab: (paneId: string) => Promise<boolean> | boolean
  closeTab: (paneId: string) => Promise<void>
  requestCloseTab: (paneId: string) => Promise<void> | void
  newTab: (cwd?: string) => Promise<void>
  persist: () => void
  commitLocalActivePane: (paneId: string) => void
  focusActive: () => void
}

export interface OverviewCallbacks {
  overviewOpen: Ref<boolean>
  openOverview: () => void
  onOverviewActivate: (paneId: string) => void
  onOverviewCloseTab: (tabId: string) => void
  onCloseTabsBulk: (paneIds: string[]) => Promise<void>
  onOverviewNewTab: (cwd?: string) => Promise<void>
  onOverviewNewTabSsh: (connectionId: string, initialCwd?: string) => Promise<void>
  onOverviewRenameTab: (paneId: string, title: string) => void
}

export function useOverviewCallbacks(opts: OverviewCallbacksOptions): OverviewCallbacks {
  const {
    tabs,
    termRefs,
    session,
    activateTab,
    closeTab,
    requestCloseTab,
    newTab,
    persist,
    commitLocalActivePane,
    focusActive,
  } = opts

  const overviewOpen = ref(false)

  function openOverview(): void {
    overviewOpen.value = true
  }

  function onOverviewActivate(paneId: string): void {
    void activateTab(paneId)
    overviewOpen.value = false
    nextTick(() => {
      const ref = termRefs[paneId]
      ref?.focus()
    })
  }

  function onOverviewCloseTab(tabId: string): void {
    void requestCloseTab(tabId)
  }

  async function onCloseTabsBulk(paneIds: string[]): Promise<void> {
    for (const id of [...paneIds].reverse()) {
      await closeTab(id)
    }
  }

  async function onOverviewNewTab(cwd?: string): Promise<void> {
    overviewOpen.value = false
    await newTab(cwd)
  }

  async function onOverviewNewTabSsh(connectionId: string, initialCwd?: string): Promise<void> {
    overviewOpen.value = false
    try {
      const result = await apiCreateSshTab(connectionId, initialCwd)
      const existing = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === result.tab_id,
      )
      if (existing) {
        commitLocalActivePane(result.tab_id)
        persist()
        nextTick(() => focusActive())
        return
      }
      const layout = ensureSplitRoot(result.layout)
      tabs.value.push({
        type: 'terminal',
        paneId: result.tab_id,
        layout,
        activePaneId: result.pane_id,
        paneMru: [result.pane_id],
        broadcastMode: false,
        broadcastActivity: 0,
        previewVisible: false,
        previewAddress: '',
        previewUrl: '',
        previewKind: 'web',
        connectionId,
      } as TerminalTab)
      commitLocalActivePane(result.tab_id)
      persist()
      nextTick(() => focusActive())
    } catch (e) {
      console.error('Failed to create SSH tab:', e)
    }
  }

  function onOverviewRenameTab(paneId: string, title: string): void {
    session.renameTab(paneId, title)
    persist()
  }

  return {
    overviewOpen,
    openOverview,
    onOverviewActivate,
    onOverviewCloseTab,
    onCloseTabsBulk,
    onOverviewNewTab,
    onOverviewNewTabSsh,
    onOverviewRenameTab,
  }
}
