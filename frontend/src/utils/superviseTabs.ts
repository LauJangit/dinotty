export interface TabCandidate {
  id: string
  reminderAt: number | null
}

export interface PickSupervisedTabInput {
  tabs: readonly TabCandidate[]
  currentTabId: string | null
  visitedTabIds: ReadonlySet<string>
  pendingTabIds: ReadonlySet<string>
}

export interface PickSupervisedTabResult {
  targetTabId: string | null
  nextVisitedTabIds: Set<string>
  reason: 'reminder' | 'sweep' | null
}

export function pickSupervisedTab(input: PickSupervisedTabInput): PickSupervisedTabResult {
  const existingTabIds = new Set<string>()
  const tabs: TabCandidate[] = []

  for (const tab of input.tabs) {
    if (existingTabIds.has(tab.id)) continue
    existingTabIds.add(tab.id)
    tabs.push(tab)
  }

  let nextVisitedTabIds = new Set([...input.visitedTabIds].filter((id) => existingTabIds.has(id)))
  if (input.currentTabId !== null && existingTabIds.has(input.currentTabId)) {
    nextVisitedTabIds.add(input.currentTabId)
  }

  let reminderCandidate: TabCandidate | null = null
  for (const tab of tabs) {
    if (
      tab.reminderAt === null ||
      tab.id === input.currentTabId ||
      input.pendingTabIds.has(tab.id)
    ) {
      continue
    }
    if (reminderCandidate === null || tab.reminderAt < reminderCandidate.reminderAt!) {
      reminderCandidate = tab
    }
  }

  if (reminderCandidate !== null) {
    return {
      targetTabId: reminderCandidate.id,
      nextVisitedTabIds,
      reason: 'reminder',
    }
  }

  const currentIndex = tabs.findIndex((tab) => tab.id === input.currentTabId)
  const sweep = (visitedTabIds: ReadonlySet<string>): string | null => {
    for (let offset = 0; offset < tabs.length; offset++) {
      const index = currentIndex === -1 ? offset : (currentIndex + offset + 1) % tabs.length
      const tab = tabs[index]
      if (
        tab.id === input.currentTabId ||
        visitedTabIds.has(tab.id) ||
        input.pendingTabIds.has(tab.id)
      ) {
        continue
      }
      return tab.id
    }
    return null
  }

  let targetTabId = sweep(nextVisitedTabIds)
  if (targetTabId !== null) {
    return { targetTabId, nextVisitedTabIds, reason: 'sweep' }
  }

  const otherTabs = tabs.filter((tab) => tab.id !== input.currentTabId)
  const exhaustedByConfirmedVisits = otherTabs.every((tab) => nextVisitedTabIds.has(tab.id))
  const hasAvailableTab = otherTabs.some((tab) => !input.pendingTabIds.has(tab.id))

  if (exhaustedByConfirmedVisits && hasAvailableTab) {
    nextVisitedTabIds = new Set(
      input.currentTabId !== null && existingTabIds.has(input.currentTabId)
        ? [input.currentTabId]
        : []
    )
    targetTabId = sweep(nextVisitedTabIds)
    if (targetTabId !== null) {
      return { targetTabId, nextVisitedTabIds, reason: 'sweep' }
    }
  }

  return { targetTabId: null, nextVisitedTabIds, reason: null }
}
