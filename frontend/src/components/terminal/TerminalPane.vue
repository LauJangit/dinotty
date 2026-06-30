<template>
  <div
    class="terminal-pane-container"
    @contextmenu.prevent="onContextMenu"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <div ref="wrapperRef" class="terminal-pane"></div>
    <SearchBar
      v-if="searchVisible && terminal"
      :terminal="terminal"
      @close="searchVisible = false"
    />
  </div>
  <TerminalContextMenu
    :visible="menuVisible"
    :x="menuX"
    :y="menuY"
    :selected-text="menuSelectedText"
    :link-type="linkType"
    :link-target="linkTarget"
    @close="closeMenu"
    @copy="onMenuCopy"
    @paste="onMenuPaste"
    @select-all="onMenuSelectAll"
    @open-file="onMenuOpenFile"
    @open-link="onMenuOpenLink"
  />
  <SelectionHandles
    :visible="handlesVisible"
    :start-x="handleStartX"
    :start-y="handleStartY"
    :end-x="handleEndX"
    :end-y="handleEndY"
    @drag="onHandleDrag"
    @drag-end="onHandleDragEnd"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../../composables/useTerminal'
import SearchBar from './SearchBar.vue'
import TerminalContextMenu from './TerminalContextMenu.vue'
import SelectionHandles from './SelectionHandles.vue'

const props = defineProps<{
  paneId: string
}>()

const emit = defineEmits<{
  titleChange: [title: string]
  shellInfo: [shell: string]
  connect: []
  disconnect: []
  fileClick: [path: string]
  previewLink: [url: string]
  linkActivate: []
  input: [data: string]
}>()

const wrapperRef = ref<HTMLElement>()
let terminal: TerminalInstance | null = null
let pendingFocus = false
const searchVisible = ref(false)

// Context menu state
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuSelectedText = ref('')

// Long-press state (mobile)
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressStartX = 0
let longPressStartY = 0
let longPressFired = false
let touchScrolling = false

// Selection handles state
const handlesVisible = ref(false)
const handleStartX = ref(0)
const handleStartY = ref(0)
const handleEndX = ref(0)
const handleEndY = ref(0)
let selAnchorRow = 0
let selAnchorCol = 0
let dragHandle: 'start' | 'end' | null = null
let selectionTouched = false

// Link context menu state
const linkType = ref<'file' | 'link'>()
const linkTarget = ref<string>()

function getTerminal() {
  return terminal
}

function focus() {
  if (terminal?.xterm) {
    pendingFocus = false
    terminal.focus()
    return
  }
  pendingFocus = true
}

function blur() {
  pendingFocus = false
  terminal?.blur()
}

function fit() {
  terminal?.fit()
}

function sendData(data: string, force?: boolean) {
  terminal?.sendData(data, force)
}

function setOutputListener(cb: ((data: string) => void) | null) {
  if (terminal) terminal.onRawOutput = cb
}

function toggleSearch() {
  searchVisible.value = !searchVisible.value
}

function adjustFontSize(delta: number) {
  terminal?.adjustFontSize(delta)
}

function resetFontSize() {
  terminal?.resetFontSize()
}

function onContextMenu(e: MouseEvent) {
  if (!terminal) return
  if (terminal.isMouseModeEnabled()) return
  const text = terminal.getSelection()
  menuSelectedText.value = text
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
}

function closeMenu() {
  menuVisible.value = false
  handlesVisible.value = false
  linkType.value = undefined
  linkTarget.value = undefined
}

function onMenuCopy() {
  // copy already handled in TerminalContextMenu
}

async function onMenuPaste(text: string) {
  terminal?.pasteText(text)
}

function onMenuSelectAll() {
  terminal?.selectAll()
}

function onMenuOpenFile(path: string) {
  emit('fileClick', path)
}

function onMenuOpenLink(url: string) {
  emit('previewLink', url)
}

// Cached cell dimensions for touch selection
let cachedCellW = 0
let cachedCellH = 0
let cachedScreenRect: DOMRect | null = null

function cacheCellDims() {
  const xt = terminal?.xterm
  if (!xt) return false
  const core = (xt as any)._core
  const dims = core?._renderService?.dimensions
  if (!dims?.css?.cell?.width || !dims.css.cell.height) return false
  cachedCellW = dims.css.cell.width
  cachedCellH = dims.css.cell.height
  const xtermEl = xt.element
  if (!xtermEl) return false
  const screen = xtermEl.querySelector('.xterm-screen') as HTMLElement
  if (!screen) return false
  cachedScreenRect = screen.getBoundingClientRect()
  return true
}

function touchToBufferPos(clientX: number, clientY: number): { col: number; row: number } | null {
  const xt = terminal?.xterm
  if (!xt || !cachedScreenRect || !cachedCellW || !cachedCellH) return null
  const col = Math.max(0, Math.floor((clientX - cachedScreenRect.left) / cachedCellW))
  const row = Math.max(0, Math.floor((clientY - cachedScreenRect.top) / cachedCellH))
  return { col: Math.min(col, xt.cols - 1), row: Math.min(row, xt.rows - 1) }
}

function findWordAt(bufferRow: number, col: number): { start: number; length: number } | null {
  const xt = terminal?.xterm
  if (!xt) return null
  const line = xt.buffer.active.getLine(bufferRow)
  if (!line) return null
  const lineText = line.translateToString(true)
  if (!lineText) return null
  const wordRegex = /[\w.:/@-]+/g
  let match: RegExpExecArray | null
  while ((match = wordRegex.exec(lineText)) !== null) {
    if (col >= match.index && col < match.index + match[0].length) {
      return { start: match.index, length: match[0].length }
    }
  }
  return null
}

function calcSelectionLength(startCol: number, startRow: number, endCol: number, endRow: number): number {
  const xt = terminal?.xterm
  if (!xt) return 0
  const cols = xt.cols
  if (startRow === endRow) {
    return Math.max(1, endCol - startCol + 1)
  }
  // xterm.js wraps at `cols` columns — use cols for intermediate lines, not content length
  let len = cols - startCol
  for (let r = startRow + 1; r < endRow; r++) {
    len += cols
  }
  len += Math.min(endCol + 1, cols)
  return Math.max(1, len)
}

function updateSelectionTo(clientX: number, clientY: number) {
  const xt = terminal?.xterm
  if (!xt) return
  const pos = touchToBufferPos(clientX, clientY)
  if (!pos) return
  const endRow = xt.buffer.active.viewportY + pos.row
  const endCol = pos.col
  const sr = terminal!.selStartRow
  const sc = terminal!.selStartCol
  if (endRow < sr || (endRow === sr && endCol < sc)) {
    xt.select(endCol, endRow, calcSelectionLength(endCol, endRow, sc, sr))
  } else {
    xt.select(sc, sr, calcSelectionLength(sc, sr, endCol, endRow))
  }
}

function bufferToPixel(col: number, bufferRow: number): { x: number; y: number } {
  const xt = terminal?.xterm
  if (!xt || !cachedScreenRect || !cachedCellW || !cachedCellH) return { x: 0, y: 0 }
  const viewportY = xt.buffer.active.viewportY
  const row = bufferRow - viewportY
  return {
    x: cachedScreenRect.left + col * cachedCellW,
    y: cachedScreenRect.top + row * cachedCellH,
  }
}

function selectionToPixelCoords(): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const xt = terminal?.xterm
  if (!xt) return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  const selection = xt.getSelectionPosition()
  if (!selection) return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  // getSelectionPosition() returns 0-based coordinates (despite type definition saying 1-based)
  // start handle: left edge of first selected char
  // end handle: right edge of last selected char (end.x is one past last selected)
  const start = bufferToPixel(selection.start.x, selection.start.y)
  const end = bufferToPixel(selection.end.x, selection.end.y)
  return { start, end }
}

// Mobile long-press to start touch selection
function onTouchStart(e: TouchEvent) {
  if (!terminal || terminal.isMouseModeEnabled()) return
  if (handlesVisible.value) return // selection mode active, don't start new long-press
  longPressFired = false
  touchScrolling = false
  const touch = e.touches[0]
  longPressStartX = touch.clientX
  longPressStartY = touch.clientY
  longPressTimer = setTimeout(() => {
    longPressFired = true

    const wordPos = selectWordAtTouch(longPressStartX, longPressStartY)
    if (!wordPos) return

    // Enter selection mode
    cacheCellDims()
    terminal!.inTouchSelection = true
    terminal!.selStartRow = wordPos.bufferRow
    terminal!.selStartCol = wordPos.startCol
    selAnchorRow = wordPos.bufferRow
    selAnchorCol = wordPos.startCol
    selectionTouched = false

    // Show handles at selection boundaries
    const coords = selectionToPixelCoords()
    handleStartX.value = coords.start.x
    handleStartY.value = coords.start.y
    handleEndX.value = coords.end.x
    handleEndY.value = coords.end.y
    handlesVisible.value = true
    dragHandle = null

    // Also show context menu (standard long-press UX)
    const text = terminal!.getSelection()
    menuSelectedText.value = text
    menuX.value = longPressStartX
    menuY.value = longPressStartY
    menuVisible.value = true
  }, 500)
}

function selectWordAtTouch(clientX: number, clientY: number): { bufferRow: number; startCol: number } | null {
  const xterm = terminal?.xterm
  if (!xterm) return null

  const xtermEl = xterm.element
  if (!xtermEl) return null

  const screen = xtermEl.querySelector('.xterm-screen') as HTMLElement
  if (!screen) return null

  const core = (xterm as any)._core
  const dims = core?._renderService?.dimensions
  if (!dims?.css?.cell?.width || !dims.css.cell.height) return null

  const { width: cellW, height: cellH } = dims.css.cell
  const rect = screen.getBoundingClientRect()

  const col = Math.floor((clientX - rect.left) / cellW)
  const row = Math.floor((clientY - rect.top) / cellH)

  if (col < 0 || row < 0 || col >= xterm.cols || row >= xterm.rows) return null

  const buffer = xterm.buffer.active
  const bufferRow = buffer.viewportY + row
  const line = buffer.getLine(bufferRow)
  if (!line) return null

  const lineText = line.translateToString(true)
  if (!lineText) return null

  const wordRegex = /[\w.:/@-]+/g
  let match: RegExpExecArray | null
  while ((match = wordRegex.exec(lineText)) !== null) {
    if (col >= match.index && col < match.index + match[0].length) {
      xterm.select(match.index, bufferRow, match[0].length)
      return { bufferRow, startCol: match.index }
    }
  }
  return null
}

function onTouchMove(e: TouchEvent) {
  if (dragHandle) return // handle drag in progress, ignore terminal touch
  if (terminal?.inTouchSelection) {
    e.preventDefault()
    if (!selectionTouched) {
      selectionTouched = true
      menuVisible.value = false // Close menu when user starts adjusting
    }
    const touch = e.touches[0]
    updateSelectionTo(touch.clientX, touch.clientY)
    menuSelectedText.value = terminal!.xterm?.getSelection() ?? ''
    const coords = selectionToPixelCoords()
    handleStartX.value = coords.start.x
    handleStartY.value = coords.start.y
    handleEndX.value = coords.end.x
    handleEndY.value = coords.end.y
    return
  }
  const touch = e.touches[0]
  // Cancel long-press timer on any movement > 10px
  if (longPressTimer && !longPressFired) {
    if (
      Math.abs(touch.clientX - longPressStartX) > 10 ||
      Math.abs(touch.clientY - longPressStartY) > 10
    ) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
  // Detect scroll gesture (vertical movement > horizontal) —
  // dispatch terminal-scroll so App.vue's keyboard guard works.
  // The viewport handlers in useTerminal.ts don't fire because
  // .xterm-screen overlays .xterm-viewport in the DOM.
  if (!touchScrolling) {
    const dx = Math.abs(touch.clientX - longPressStartX)
    const dy = Math.abs(touch.clientY - longPressStartY)
    if (dy > dx && dy > 15) {
      touchScrolling = true
      if (terminal) terminal.touchMoved = true
      (e.currentTarget as HTMLElement).dispatchEvent(
        new CustomEvent('terminal-scroll', { bubbles: true })
      )
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (dragHandle) return // handle drag in progress, ignore terminal touch
  if (terminal?.inTouchSelection) {
    e.preventDefault()
    terminal.inTouchSelection = false
    const text = terminal.xterm?.getSelection() ?? ''
    menuSelectedText.value = text
    if (selectionTouched) {
      if (text) {
        // User dragged to adjust → show menu at end handle
        menuX.value = handleEndX.value
        menuY.value = handleEndY.value + 24
        menuVisible.value = true
      } else {
        handlesVisible.value = false
      }
    }
    // If not touched: menu already visible from long press, keep it
    selectionTouched = false
    return
  }
  if (longPressFired) {
    e.preventDefault()
    longPressFired = false
  }
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (touchScrolling) {
    touchScrolling = false
    (e.currentTarget as HTMLElement).dispatchEvent(
      new CustomEvent('terminal-scroll', { bubbles: true })
    )
  }
}

function onTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressFired = false
  touchScrolling = false
  selectionTouched = false
  dragHandle = null
  if (terminal) terminal.inTouchSelection = false
  handlesVisible.value = false
}

// Handle drag from selection handles
function onHandleDrag(handle: 'start' | 'end', clientX: number, clientY: number) {
  const xt = terminal?.xterm
  if (!xt) return
  selectionTouched = true
  if (!dragHandle) {
    dragHandle = handle
    // Block scroll handler during handle drag
    terminal!.inTouchSelection = true
    menuVisible.value = false
    if (handle === 'end') {
      selAnchorRow = terminal!.selStartRow
      selAnchorCol = terminal!.selStartCol
    } else {
      const selPos = xt.getSelectionPosition()
      if (selPos) {
        selAnchorRow = selPos.end.y
        selAnchorCol = selPos.end.x - 1 // end.x is one past last selected
      }
    }
  }
  const pos = touchToBufferPos(clientX, clientY)
  if (!pos) return
  // Convert viewport-relative to absolute buffer coordinates
  const moveRow = xt.buffer.active.viewportY + pos.row
  const moveCol = pos.col
  if (moveRow < selAnchorRow || (moveRow === selAnchorRow && moveCol < selAnchorCol)) {
    xt.select(moveCol, moveRow, calcSelectionLength(moveCol, moveRow, selAnchorCol, selAnchorRow))
    terminal!.selStartRow = moveRow
    terminal!.selStartCol = moveCol
  } else {
    xt.select(selAnchorCol, selAnchorRow, calcSelectionLength(selAnchorCol, selAnchorRow, moveCol, moveRow))
    terminal!.selStartRow = selAnchorRow
    terminal!.selStartCol = selAnchorCol
  }
  menuSelectedText.value = xt.getSelection() ?? ''
  const coords = selectionToPixelCoords()
  handleStartX.value = coords.start.x
  handleStartY.value = coords.start.y
  handleEndX.value = coords.end.x
  handleEndY.value = coords.end.y
}

function onHandleDragEnd() {
  if (terminal) terminal.inTouchSelection = false
  dragHandle = null
  const text = terminal?.xterm?.getSelection() ?? ''
  menuSelectedText.value = text
  if (text) {
    menuX.value = handleEndX.value
    menuY.value = handleEndY.value + 24
    menuVisible.value = true
  } else {
    handlesVisible.value = false
  }
}

onMounted(() => {
  terminal = new TerminalInstance(props.paneId)
  terminal.onTitleChange = (tv) => emit('titleChange', tv)
  terminal.onShellInfo = (s) => emit('shellInfo', s)
  terminal.onConnect = () => emit('connect')
  terminal.onDisconnect = () => emit('disconnect')
  terminal.onInput = (data) => emit('input', data)
  terminal.onFileClick = (path, x, y) => {
    emit('linkActivate')
    linkType.value = 'file'
    linkTarget.value = path
    if (x != null && y != null) {
      menuX.value = x
      menuY.value = y
    }
    menuSelectedText.value = ''
    menuVisible.value = true
  }
  terminal.onPreviewLink = (url, x, y) => {
    emit('linkActivate')
    linkType.value = 'link'
    linkTarget.value = url
    if (x != null && y != null) {
      menuX.value = x
      menuY.value = y
    }
    menuSelectedText.value = ''
    menuVisible.value = true
  }

  requestAnimationFrame(() => {
    if (wrapperRef.value) {
      terminal!.attach(wrapperRef.value)
      if (pendingFocus) {
        pendingFocus = false
        terminal!.focus()
      }
    }
  })
})

onBeforeUnmount(() => {
  terminal?.destroy()
  terminal = null
})

defineExpose({ getTerminal, focus, blur, fit, sendData, setOutputListener, toggleSearch, adjustFontSize, resetFontSize })
</script>

<style scoped>
.terminal-pane-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
}
.terminal-pane {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
