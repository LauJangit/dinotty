import { watch } from 'vue'
import { useSessionStore } from '../stores/sessionStore'
import { getAllLeaves, type Tab } from '../types/pane'
import { nextRevealNavGen } from '../utils/navGen'
import { pickSupervisedTab, type TabCandidate } from '../utils/superviseTabs'
import { useNotification } from './useNotification'
import { useWorkspaces } from './useWorkspaces'

function paneIdsOf(tab: Tab): string[] {
  if (tab.type === 'plugin') return [tab.paneId]
  return [tab.paneId, ...getAllLeaves(tab.layout).map((leaf) => leaf.paneId)]
}

export function useSuperviseTabs() {
  const session = useSessionStore()
  const { workspaces, matchWorkspace } = useWorkspaces()
  const { firstUnreadAtByPane } = useNotification()
  const confirmedVisited = new Set<string>()
  const pending = new Map<string, number>()
  let tokenCounter = 0

  function reminderAt(tab: Tab): number | null {
    let oldest: number | null = null
    for (const paneId of paneIdsOf(tab)) {
      const timestamp = firstUnreadAtByPane[paneId]
      if (timestamp === null || timestamp === undefined) continue
      if (oldest === null || timestamp < oldest) oldest = timestamp
    }
    return oldest
  }

  function orderedCandidates(): TabCandidate[] {
    const orderedTabs: Tab[] = []
    const orderedTabIds = new Set<string>()
    const sortedWorkspaces = [...workspaces.value].sort((a, b) => a.order - b.order)

    for (const workspace of sortedWorkspaces) {
      for (const tab of session.tabs) {
        const matchedWorkspace =
          tab.type === 'terminal'
            ? matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.workspaceId)
            : tab.workspaceId
              ? (workspaces.value.find((item) => item.id === tab.workspaceId) ?? null)
              : null
        if (matchedWorkspace?.id !== workspace.id || orderedTabIds.has(tab.paneId)) continue
        orderedTabs.push(tab)
        orderedTabIds.add(tab.paneId)
      }
    }

    for (const tab of session.tabs) {
      if (orderedTabIds.has(tab.paneId)) continue
      orderedTabs.push(tab)
      orderedTabIds.add(tab.paneId)
    }

    return orderedTabs.map((tab) => ({
      id: tab.paneId,
      reminderAt: reminderAt(tab),
    }))
  }

  watch(
    () => session.activePaneId,
    (id) => {
      const currentTabIds = new Set(session.tabs.map((tab) => tab.paneId))
      for (const visitedId of confirmedVisited) {
        if (!currentTabIds.has(visitedId)) confirmedVisited.delete(visitedId)
      }
      if (id !== null && currentTabIds.has(id) && !pending.has(id)) {
        confirmedVisited.add(id)
      }
    },
    { immediate: true },
  )

  async function supervise(activate: (id: string) => Promise<boolean>): Promise<void> {
    const result = pickSupervisedTab({
      tabs: orderedCandidates(),
      currentTabId: session.activePaneId,
      visitedTabIds: confirmedVisited,
      pendingTabIds: new Set(pending.keys()),
    })

    confirmedVisited.clear()
    for (const id of result.nextVisitedTabIds) confirmedVisited.add(id)
    if (result.targetTabId === null) return

    const target = result.targetTabId
    const token = ++tokenCounter
    pending.set(target, token)

    const settle = (promote: boolean) => {
      // Token identity keeps a late attempt from mutating a newer reservation of this tab.
      if (pending.get(target) !== token) return
      pending.delete(target)
      if (promote) confirmedVisited.add(target)
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const activationSettled = Promise.resolve()
      .then(() => activate(target))
      .then(
        (activated) => settle(activated === true),
        () => settle(false),
      )
      .finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId)
      })
    const timedOut = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        if (pending.get(target) === token) {
          pending.delete(target)
          // Superseding the abandoned navigation prevents it from committing after the timeout.
          nextRevealNavGen()
        }
        resolve()
      }, 10_000)
    })

    await Promise.race([activationSettled, timedOut])
  }

  return { supervise }
}
