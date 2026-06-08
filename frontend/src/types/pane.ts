/** 叶子节点：一个终端 Pane */
export interface LeafPane {
  type: 'leaf'
  paneId: string
  title: string
  ratio: number
  zoomed: boolean
}

/** 分割容器：水平或垂直排列子节点 */
export interface SplitPane {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: PaneLayout[]
  ratios: number[]
}

export type PaneLayout = LeafPane | SplitPane

/** Terminal tab with split pane layout */
export interface TerminalTab {
  type: 'terminal'
  paneId: string           // Tab's stable identifier (not a leaf paneId)
  layout: PaneLayout
  activePaneId: string     // Currently focused leaf pane
  broadcastMode: boolean
  broadcastActivity: number // Incremented on each broadcast input to re-trigger banner
  previewVisible: boolean
  previewAddress: string
  previewUrl: string
  previewKind: 'web' | 'files'
}

/** Plugin tab (unchanged) */
export interface PluginTab {
  type: 'plugin'
  paneId: string
  title: string
  pluginId: string
}

export type Tab = TerminalTab | PluginTab

/** Migrate old tab format (with direct paneId) to new layout format */
export function migrateTab(raw: any): TerminalTab {
  if (raw.paneId && !raw.layout) {
    return {
      type: 'terminal',
      paneId: raw.paneId,
      layout: { type: 'leaf', paneId: raw.paneId, title: raw.title ?? 'Terminal', ratio: 1, zoomed: false },
      activePaneId: raw.paneId,
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: raw.previewVisible ?? false,
      previewAddress: raw.previewAddress ?? '',
      previewUrl: raw.previewUrl ?? '',
      previewKind: raw.previewKind ?? 'web',
    }
  }
  return raw as TerminalTab
}

/** Find a leaf node by paneId in the layout tree */
export function findLeaf(node: PaneLayout, paneId: string): LeafPane | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null
  for (const child of node.children) {
    const found = findLeaf(child, paneId)
    if (found) return found
  }
  return null
}

/** Find the parent SplitPane that directly contains the given paneId */
export function findParentSplit(node: PaneLayout, paneId: string): SplitPane | null {
  if (node.type === 'leaf') return null
  for (const child of node.children) {
    if (child.type === 'leaf' && child.paneId === paneId) return node
    const found = findParentSplit(child, paneId)
    if (found) return found
  }
  return null
}

/** Get all leaf nodes in order */
export function getAllLeaves(node: PaneLayout): LeafPane[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap(c => getAllLeaves(c))
}

/** Find the first leaf in the tree */
export function findFirstLeaf(node: PaneLayout): LeafPane {
  if (node.type === 'leaf') return node
  return findFirstLeaf(node.children[0])
}

/** Replace a leaf node by paneId with a new PaneLayout */
export function replaceLeaf(node: PaneLayout, paneId: string, replacement: PaneLayout): boolean {
  if (node.type === 'split') {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      if (child.type === 'leaf' && child.paneId === paneId) {
        node.children[i] = replacement
        return true
      }
      if (replaceLeaf(child, paneId, replacement)) return true
    }
  }
  return false
}

/** Replace a specific node in the tree with another node */
export function replaceNode(root: PaneLayout, target: PaneLayout, replacement: PaneLayout): boolean {
  if (root.type === 'split') {
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i] === target) {
        root.children[i] = replacement
        return true
      }
      if (replaceNode(root.children[i], target, replacement)) return true
    }
  }
  return false
}

/** Redistribute ratios equally among children of a split node */
export function redistributeRatios(split: SplitPane) {
  const n = split.children.length
  const ratio = 1 / n
  split.ratios = Array(n).fill(ratio)
  split.children.forEach(c => {
    if (c.type === 'leaf') c.ratio = ratio
  })
}

/** Clear all zoomed states in the tree */
export function clearAllZoom(node: PaneLayout) {
  if (node.type === 'leaf') {
    node.zoomed = false
  } else {
    node.children.forEach(c => clearAllZoom(c))
  }
}

/** Equalize all ratios recursively */
export function equalizeRecursive(node: PaneLayout) {
  if (node.type === 'leaf') return
  const n = node.children.length
  const ratio = 1 / n
  node.ratios = Array(n).fill(ratio)
  node.children.forEach(c => {
    if (c.type === 'leaf') c.ratio = ratio
    else equalizeRecursive(c)
  })
}

/**
 * Remove a leaf from its parent split. If the parent ends up with one child,
 * collapse it by replacing the parent with the remaining child.
 * Returns the removed leaf, or null if not found.
 */
export function removeLeaf(root: PaneLayout, paneId: string): LeafPane | null {
  const parent = findParentSplit(root, paneId)
  if (!parent) {
    // The leaf is the root — can't remove
    if (root.type === 'leaf' && root.paneId === paneId) return root
    return null
  }

  const idx = parent.children.findIndex(c => c.type === 'leaf' && c.paneId === paneId)
  if (idx === -1) return null

  const removed = parent.children.splice(idx, 1)[0] as LeafPane
  parent.ratios.splice(idx, 1)
  redistributeRatios(parent)

  // If only one child left, collapse the split
  if (parent.children.length === 1) {
    const remaining = parent.children[0]
    replaceNode(root, parent, remaining)
  }

  return removed
}
