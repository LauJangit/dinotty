import { ref, computed, type Ref } from 'vue'
import {
  createEditorLeaf,
  findEditorLeaf,
  findParentEditorSplit,
  getAllEditorLeaves,
  findFirstEditorLeaf,
  redistributeEditorRatios,
  replaceEditorLeaf,
  replaceEditorNode,
  genEditorLeafId,
  genEditorSplitId,
  type EditorLeafPane,
  type EditorSplitPane,
  type EditorPaneLayout,
} from '../types/editorPane'

export function useEditorSplit(opts: { paneId: () => string }) {
  const editorLayout = ref<EditorPaneLayout>(createEditorLeaf()) as Ref<EditorPaneLayout>
  const activeEditorLeafId = ref<string | null>(
    editorLayout.value.type === 'editor-leaf' ? editorLayout.value.id : null
  )

  /** The currently active leaf, derived from activeEditorLeafId */
  const activeLeaf = computed(() => {
    if (!activeEditorLeafId.value) return null
    return findEditorLeaf(editorLayout.value, activeEditorLeafId.value)
  })

  /** Whether the layout has more than one pane */
  const isSplit = computed(() => {
    return editorLayout.value.type === 'editor-split'
  })

  /** All leaves count */
  const leafCount = computed(() => getAllEditorLeaves(editorLayout.value).length)

  /** Open a file in the currently active pane */
  function openFileInActivePane(filePath: string, isDir: boolean) {
    const leaf = activeLeaf.value
    if (!leaf) return
    leaf.filePath = filePath
    leaf.isDir = isDir
  }

  /** Split the active pane and open a file in the new pane */
  function openFileInNewPane(
    filePath: string,
    isDir: boolean,
    direction: 'horizontal' | 'vertical' = 'horizontal'
  ) {
    const leaf = activeLeaf.value
    if (!leaf) return

    const newLeaf: EditorLeafPane = {
      type: 'editor-leaf',
      id: genEditorLeafId(),
      filePath,
      isDir,
      ratio: 0.5,
      zoomed: false,
    }

    // If the layout itself is the leaf being split, wrap both in a split
    if (editorLayout.value.type === 'editor-leaf') {
      const split: EditorSplitPane = {
        type: 'editor-split',
        id: genEditorSplitId(),
        direction,
        children: [{ ...editorLayout.value, ratio: 0.5 }, newLeaf],
        ratios: [0.5, 0.5],
      }
      editorLayout.value = split
      activeEditorLeafId.value = newLeaf.id
      return
    }

    // Otherwise, find the leaf in the tree and replace it with a split
    const split: EditorSplitPane = {
      type: 'editor-split',
      id: genEditorSplitId(),
      direction,
      children: [{ ...leaf, ratio: 0.5 }, newLeaf],
      ratios: [0.5, 0.5],
    }
    replaceEditorLeaf(editorLayout.value, leaf.id, split)
    activeEditorLeafId.value = newLeaf.id
  }

  /** Close an editor pane */
  function closeEditorPane(leafId: string) {
    const parent = findParentEditorSplit(editorLayout.value, leafId)

    if (!parent) {
      // Last pane — just clear the file
      const leaf = findEditorLeaf(editorLayout.value, leafId)
      if (leaf) {
        leaf.filePath = null
        leaf.isDir = false
      }
      return
    }

    // Remove from parent
    const idx = parent.children.findIndex(
      (c) => c.type === 'editor-leaf' && c.id === leafId
    )
    if (idx === -1) return
    parent.children.splice(idx, 1)
    parent.ratios.splice(idx, 1)
    redistributeEditorRatios(parent)

    // Collapse single-child splits (but not the root if it has only one leaf child)
    if (parent.children.length === 1) {
      const onlyChild = parent.children[0]
      // If parent is the root, replace root with the only child
      if (editorLayout.value === parent) {
        editorLayout.value = onlyChild
      } else {
        replaceEditorNode(editorLayout.value, parent, onlyChild)
      }
    }

    // If the closed pane was active, switch to the first remaining leaf
    if (activeEditorLeafId.value === leafId) {
      const first = findFirstEditorLeaf(editorLayout.value)
      activeEditorLeafId.value = first?.id ?? null
    }
  }

  /** Set focus on a specific editor pane */
  function focusEditorPane(leafId: string) {
    activeEditorLeafId.value = leafId
  }

  return {
    editorLayout,
    activeEditorLeafId,
    activeLeaf,
    isSplit,
    leafCount,
    openFileInActivePane,
    openFileInNewPane,
    closeEditorPane,
    focusEditorPane,
  }
}
