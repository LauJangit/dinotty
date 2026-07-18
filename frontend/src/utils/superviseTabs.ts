export interface TabCandidate {
  id: string
  reminderAt: number | null
}

export interface PickSupervisedTabInput {
  tabs: readonly TabCandidate[]
  currentTabId: string | null
  pendingTabIds: ReadonlySet<string>
}

export interface PickSupervisedTabResult {
  targetTabId: string | null
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
      reason: 'reminder',
    }
  }

  const currentIndex = tabs.findIndex((tab) => tab.id === input.currentTabId)
  for (let offset = 0; offset < tabs.length; offset++) {
    const index = currentIndex === -1 ? offset : (currentIndex + offset + 1) % tabs.length
    const tab = tabs[index]
    if (tab.id === input.currentTabId || input.pendingTabIds.has(tab.id)) continue
    return { targetTabId: tab.id, reason: 'sweep' }
  }

  return { targetTabId: null, reason: null }
}
