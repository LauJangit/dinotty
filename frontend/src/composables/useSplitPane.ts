import { type Ref, nextTick } from 'vue'
import type { Tab, TerminalTab, PaneLayout, LeafPane, SplitPane } from '../types/pane'
import {
  findLeaf, findParentSplit, getAllLeaves, findFirstLeaf,
  replaceLeaf, replaceNode, redistributeRatios, clearAllZoom, equalizeRecursive,
  removeLeaf,
} from '../types/pane'
import type TerminalPane from '../components/terminal/TerminalPane.vue'
import type { SyncClientMsg } from '../types/protocol'

export function useSplitPane(opts: {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  termRefs: Record<string, InstanceType<typeof TerminalPane>>
  genPaneId: () => string
  sendSync: (msg: SyncClientMsg) => void
  persist: () => void
}) {
  const { tabs, activePaneId, termRefs, genPaneId, sendSync, persist } = opts

  function getActiveTerminal(): TerminalTab | null {
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return null
    return tab
  }

  function findTabByPaneId(paneId: string): TerminalTab | null {
    const tab = tabs.value.find(t => {
      if (t.type !== 'terminal') return false
      return !!findLeaf(t.layout, paneId)
    })
    return tab as TerminalTab | null
  }

  /** Split the active pane in the given direction */
  function splitPane(direction: 'horizontal' | 'vertical') {
    const tab = getActiveTerminal()
    if (!tab) return
    if (getAllLeaves(tab.layout).length >= 6) return

    const newPaneId = genPaneId()
    const currentLeaf = findLeaf(tab.layout, tab.activePaneId)
    if (!currentLeaf || currentLeaf.type !== 'leaf') return

    const newLeaf: LeafPane = {
      type: 'leaf',
      paneId: newPaneId,
      title: 'Terminal',
      ratio: 0.5,
      zoomed: false,
    }

    const split: SplitPane = {
      type: 'split',
      direction,
      children: [{ ...currentLeaf, ratio: 0.5 }, newLeaf],
      ratios: [0.5, 0.5],
    }

    if (tab.layout.type === 'leaf') {
      tab.layout = split
    } else {
      replaceLeaf(tab.layout, tab.activePaneId, split)
    }

    tab.activePaneId = newPaneId
    sendSync({ type: 'create_tab', pane_id: newPaneId })
    persist()
    nextTick(() => termRefs[newPaneId]?.focus())
  }

  /** Close a pane. If it's the last leaf, close the entire tab. */
  function closePane(paneId: string): boolean {
    const tab = findTabByPaneId(paneId)
    if (!tab) return false

    const parent = findParentSplit(tab.layout, paneId)
    if (!parent) {
      // This is the only leaf — signal to close the tab
      return false
    }

    const idx = parent.children.findIndex(c => c.type === 'leaf' && c.paneId === paneId)
    if (idx === -1) return false

    parent.children.splice(idx, 1)
    parent.ratios.splice(idx, 1)
    redistributeRatios(parent)

    if (parent.children.length === 1) {
      const remaining = parent.children[0]
      replaceNode(tab.layout, parent, remaining)
    }

    if (tab.activePaneId === paneId) {
      tab.activePaneId = findFirstLeaf(tab.layout).paneId
    }

    if (getAllLeaves(tab.layout).length <= 1) {
      tab.broadcastMode = false
    }

    sendSync({ type: 'close_tab', pane_id: paneId })
    persist()
    nextTick(() => termRefs[tab.activePaneId]?.focus())
    return true
  }

  /** Focus a specific pane */
  function focusPane(paneId: string) {
    const tab = findTabByPaneId(paneId)
    if (tab) {
      tab.activePaneId = paneId
      clearAllZoom(tab.layout)
      persist()
      nextTick(() => termRefs[paneId]?.focus())
    }
  }

  /** Get the bounding rect of a pane's DOM element */
  function getPaneRect(paneId: string): DOMRect | null {
    const el = (termRefs[paneId] as any)?.$el as HTMLElement | undefined
    return el?.getBoundingClientRect() ?? null
  }

  /** Check if rectB is in the given direction from rectA */
  function isDirection(rectA: DOMRect, rectB: DOMRect, direction: 'left' | 'right' | 'up' | 'down'): boolean {
    const cx = rectA.left + rectA.width / 2
    const cy = rectA.top + rectA.height / 2
    const tx = rectB.left + rectB.width / 2
    const ty = rectB.top + rectB.height / 2

    switch (direction) {
      case 'left': return tx < cx
      case 'right': return tx > cx
      case 'up': return ty < cy
      case 'down': return ty > cy
    }
  }

  /** Distance between centers of two rects */
  function centerDistance(a: DOMRect, b: DOMRect): number {
    const ax = a.left + a.width / 2
    const ay = a.top + a.height / 2
    const bx = b.left + b.width / 2
    const by = b.top + b.height / 2
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
  }

  /** Focus the nearest pane in the given spatial direction */
  function focusNeighbor(direction: 'left' | 'right' | 'up' | 'down') {
    const tab = getActiveTerminal()
    if (!tab) return

    const currentRect = getPaneRect(tab.activePaneId)
    if (!currentRect) return

    const leaves = getAllLeaves(tab.layout)
    const candidates = leaves
      .filter(l => l.paneId !== tab.activePaneId)
      .map(l => ({ pane: l, rect: getPaneRect(l.paneId) }))
      .filter((c): c is { pane: LeafPane; rect: DOMRect } => c.rect !== null && isDirection(currentRect, c.rect, direction))

    if (candidates.length === 0) return

    const nearest = candidates.reduce((best, c) =>
      centerDistance(currentRect, c.rect) < centerDistance(currentRect, best.rect) ? c : best,
    )
    focusPane(nearest.pane.paneId)
  }

  /** Focus next pane in order */
  function focusNext() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaves = getAllLeaves(tab.layout)
    const idx = leaves.findIndex(l => l.paneId === tab.activePaneId)
    const next = leaves[(idx + 1) % leaves.length]
    focusPane(next.paneId)
  }

  /** Focus previous pane in order */
  function focusPrev() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaves = getAllLeaves(tab.layout)
    const idx = leaves.findIndex(l => l.paneId === tab.activePaneId)
    const prev = leaves[(idx - 1 + leaves.length) % leaves.length]
    focusPane(prev.paneId)
  }

  /** Toggle zoom on the active pane */
  function toggleZoom() {
    const tab = getActiveTerminal()
    if (!tab) return
    const leaf = findLeaf(tab.layout, tab.activePaneId)
    if (!leaf || leaf.type !== 'leaf') return
    leaf.zoomed = !leaf.zoomed
    persist()
    nextTick(() => termRefs[tab.activePaneId]?.fit())
  }

  /** Equalize all pane ratios */
  function equalizePanes() {
    const tab = getActiveTerminal()
    if (!tab) return
    equalizeRecursive(tab.layout)
    persist()
    nextTick(() => {
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
    })
  }

  /** Toggle broadcast input mode */
  function toggleBroadcast() {
    const tab = getActiveTerminal()
    if (!tab) return
    tab.broadcastMode = !tab.broadcastMode
    persist()
  }

  /** Keyboard resize: adjust current pane's ratio by step */
  function keyboardResize(direction: 'left' | 'right' | 'up' | 'down') {
    const tab = getActiveTerminal()
    if (!tab) return

    const parent = findParentSplit(tab.layout, tab.activePaneId)
    if (!parent) return

    const idx = parent.children.findIndex(c =>
      c.type === 'leaf' && c.paneId === tab.activePaneId,
    )
    if (idx === -1) return

    const step = 0.05

    if (parent.direction === 'horizontal') {
      if (direction === 'left' && idx > 0) {
        parent.ratios[idx] = Math.max(0.1, parent.ratios[idx] - step)
        parent.ratios[idx - 1] += step
      } else if (direction === 'right' && idx < parent.children.length - 1) {
        parent.ratios[idx] = Math.min(0.9, parent.ratios[idx] + step)
        parent.ratios[idx + 1] -= step
      }
    } else {
      if (direction === 'up' && idx > 0) {
        parent.ratios[idx] = Math.max(0.1, parent.ratios[idx] - step)
        parent.ratios[idx - 1] += step
      } else if (direction === 'down' && idx < parent.children.length - 1) {
        parent.ratios[idx] = Math.min(0.9, parent.ratios[idx] + step)
        parent.ratios[idx + 1] -= step
      }
    }

    parent.children.forEach((c, i) => {
      if (c.type === 'leaf') c.ratio = parent.ratios[i]
    })

    persist()
    nextTick(() => {
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
    })
  }

  /** Handle broadcast input: send data to all other panes in the same tab */
  function onTerminalInput(sourcePaneId: string, data: string) {
    const tab = findTabByPaneId(sourcePaneId)
    if (!tab || !tab.broadcastMode) return

    const leaves = getAllLeaves(tab.layout)
    for (const leaf of leaves) {
      if (leaf.paneId !== sourcePaneId) {
        termRefs[leaf.paneId]?.sendData(data)
      }
    }
    // Increment activity counter to re-trigger broadcast banner
    tab.broadcastActivity++
  }

  /** Reorder a pane by dragging: move source next to target */
  function reorderPane(sourcePaneId: string, targetPaneId: string, position: 'before' | 'after') {
    if (sourcePaneId === targetPaneId) return

    const tab = findTabByPaneId(sourcePaneId)
    if (!tab) return

    const sourceLeaf = findLeaf(tab.layout, sourcePaneId)
    const targetLeaf = findLeaf(tab.layout, targetPaneId)
    if (!sourceLeaf || !targetLeaf) return

    const sourceParent = findParentSplit(tab.layout, sourcePaneId)
    const targetParent = findParentSplit(tab.layout, targetPaneId)

    // Both must be in some split (can't be root leaves since header only shows in split mode)
    if (!sourceParent || !targetParent) return

    const sameParent = sourceParent === targetParent

    // Remove source from its current parent
    const sourceIdx = sourceParent.children.findIndex(c => c.type === 'leaf' && c.paneId === sourcePaneId)
    if (sourceIdx === -1) return

    const [removed] = sourceParent.children.splice(sourceIdx, 1)
    sourceParent.ratios.splice(sourceIdx, 1)

    // Handle collapsing if source parent has only one child left
    let effectiveTargetParent = targetParent
    if (sourceParent.children.length === 1 && !sameParent) {
      const remaining = sourceParent.children[0]
      replaceNode(tab.layout, sourceParent, remaining)
      // Re-find target parent since tree structure changed
      effectiveTargetParent = findParentSplit(tab.layout, targetPaneId) ?? targetParent
    }

    // Find target index in its parent
    const targetIdx = effectiveTargetParent.children.findIndex(c =>
      c.type === 'leaf' && c.paneId === targetPaneId,
    )
    if (targetIdx === -1) return

    // Insert source at the correct position
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1
    effectiveTargetParent.children.splice(insertIdx, 0, removed)

    // Redistribute ratios equally
    redistributeRatios(effectiveTargetParent)

    persist()
    nextTick(() => {
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
    })
  }

  /** Update title for a leaf pane */
  function updatePaneTitle(paneId: string, title: string) {
    const tab = findTabByPaneId(paneId)
    if (!tab) return
    const leaf = findLeaf(tab.layout, paneId)
    if (leaf) {
      leaf.title = title || 'Terminal'
      persist()
    }
  }

  /** Fit all panes in the active tab */
  function fitActiveTabPanes() {
    const tab = getActiveTerminal()
    if (!tab) return
    nextTick(() => {
      getAllLeaves(tab.layout).forEach(l => termRefs[l.paneId]?.fit())
    })
  }

  return {
    splitPane,
    closePane,
    focusPane,
    focusNeighbor,
    focusNext,
    focusPrev,
    toggleZoom,
    equalizePanes,
    toggleBroadcast,
    keyboardResize,
    onTerminalInput,
    reorderPane,
    updatePaneTitle,
    fitActiveTabPanes,
    findTabByPaneId,
    getAllLeaves,
  }
}
