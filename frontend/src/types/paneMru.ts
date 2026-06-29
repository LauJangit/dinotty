export function initializePaneMru(layoutPaneIds: string[], activePaneId: string): string[] {
  return reconcilePaneMru([activePaneId], layoutPaneIds, activePaneId)
}

export function touchPaneMru(paneMru: string[], paneId: string): string[] {
  return [paneId, ...paneMru.filter((id) => id !== paneId)]
}

export function removePaneFromMru(
  paneMru: string[],
  paneId: string
): { paneMru: string[]; nextPaneId: string | null } {
  const next = paneMru.filter((id) => id !== paneId)
  return { paneMru: next, nextPaneId: next[0] ?? null }
}

export function reconcilePaneMru(
  paneMru: string[],
  layoutPaneIds: string[],
  activePaneId: string
): string[] {
  const valid = new Set(layoutPaneIds)
  const seen = new Set<string>()
  const result: string[] = []

  for (const id of paneMru) {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }

  if (result.length === 0 && valid.has(activePaneId)) {
    seen.add(activePaneId)
    result.push(activePaneId)
  }

  for (const id of layoutPaneIds) {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }

  return result
}
