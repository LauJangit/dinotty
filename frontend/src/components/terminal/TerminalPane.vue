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
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../../composables/useTerminal'
import SearchBar from './SearchBar.vue'
import TerminalContextMenu from './TerminalContextMenu.vue'

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

// Link context menu state
const linkType = ref<'file' | 'link'>()
const linkTarget = ref<string>()

function getTerminal() {
  return terminal
}

function focus() {
  terminal?.focus()
}

function blur() {
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

// Mobile long-press to start touch selection
function onTouchStart(e: TouchEvent) {
  if (!terminal || terminal.isMouseModeEnabled()) return
  longPressFired = false
  const touch = e.touches[0]
  longPressStartX = touch.clientX
  longPressStartY = touch.clientY
  longPressTimer = setTimeout(() => {
    longPressFired = true
    if (!cacheCellDims()) return
    const xt = terminal!.xterm
    if (!xt) return
    const pos = touchToBufferPos(longPressStartX, longPressStartY)
    if (!pos) return
    const bufferRow = xt.buffer.active.viewportY + pos.row
    const word = findWordAt(bufferRow, pos.col)
    if (word) {
      xt.select(word.start, bufferRow, word.length)
      terminal!.selStartRow = bufferRow
      terminal!.selStartCol = word.start
    } else {
      xt.select(pos.col, bufferRow, 1)
      terminal!.selStartRow = bufferRow
      terminal!.selStartCol = pos.col
    }
    terminal!.inTouchSelection = true
    menuSelectedText.value = xt.getSelection()
  }, 500)
}

function onTouchMove(e: TouchEvent) {
  if (terminal?.inTouchSelection) {
    const touch = e.touches[0]
    updateSelectionTo(touch.clientX, touch.clientY)
    menuSelectedText.value = terminal!.xterm?.getSelection() ?? ''
    return
  }
  if (longPressTimer && !longPressFired) {
    const touch = e.touches[0]
    if (
      Math.abs(touch.clientX - longPressStartX) > 10 ||
      Math.abs(touch.clientY - longPressStartY) > 10
    ) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (terminal?.inTouchSelection) {
    e.preventDefault()
    terminal.inTouchSelection = false
    menuSelectedText.value = terminal.xterm?.getSelection() ?? ''
    menuX.value = longPressStartX
    menuY.value = longPressStartY
    menuVisible.value = true
    return
  }
  if (longPressFired) {
    e.preventDefault()
    e.stopPropagation()
    longPressFired = false
  }
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressFired = false
  if (terminal) terminal.inTouchSelection = false
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
    }
  })
})

onBeforeUnmount(() => {
  terminal?.destroy()
  terminal = null
})

defineExpose({ getTerminal, focus, blur, fit, sendData, setOutputListener, toggleSearch })
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
