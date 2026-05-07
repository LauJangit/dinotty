<template>
  <div
    v-if="active"
    class="selection-overlay"
    @touchstart.prevent="onTouchStart"
    @touchmove.prevent="onTouchMove"
    @touchend="onTouchEnd"
  >
    <div class="selection-highlight" :style="highlightStyle"></div>
    <div class="selection-toolbar">
      <button @click="doCopy">Copy</button>
      <button @click="doSelectAll">All</button>
      <button @click="cancel">Cancel</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  getTerminal: () => any
}>()

const active = ref(false)
const startRow = ref(0)
const startCol = ref(0)
const endRow = ref(0)
const endCol = ref(0)

let charWidth = 0
let charHeight = 0
let termRect: DOMRect | null = null
let xterm: any = null

function activate() {
  xterm = props.getTerminal()?.xterm
  if (!xterm) return

  const screen = xterm.element?.querySelector('.xterm-screen') as HTMLElement
  if (!screen) return

  termRect = screen.getBoundingClientRect()
  // Estimate char dimensions from xterm's core
  charWidth = termRect.width / xterm.cols
  charHeight = termRect.height / xterm.rows

  active.value = true
  startRow.value = 0
  startCol.value = 0
  endRow.value = 0
  endCol.value = 0
}

function cancel() {
  active.value = false
  xterm?.clearSelection()
}

function posToCell(clientX: number, clientY: number): { row: number; col: number } {
  if (!termRect) return { row: 0, col: 0 }
  const col = Math.max(0, Math.min(xterm.cols - 1, Math.floor((clientX - termRect.left) / charWidth)))
  const row = Math.max(0, Math.min(xterm.rows - 1, Math.floor((clientY - termRect.top) / charHeight)))
  return { row, col }
}

function onTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  const { row, col } = posToCell(t.clientX, t.clientY)
  startRow.value = row
  startCol.value = col
  endRow.value = row
  endCol.value = col
}

function onTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  const { row, col } = posToCell(t.clientX, t.clientY)
  endRow.value = row
  endCol.value = col
}

function onTouchEnd() {
  // Selection made, keep overlay visible for toolbar
}

const highlightStyle = computed(() => {
  if (!termRect) return {}

  const r1 = Math.min(startRow.value, endRow.value)
  const r2 = Math.max(startRow.value, endRow.value)
  const c1 = r1 === r2 ? Math.min(startCol.value, endCol.value) : (startRow.value <= endRow.value ? startCol.value : endCol.value)
  const c2 = r1 === r2 ? Math.max(startCol.value, endCol.value) : (startRow.value <= endRow.value ? endCol.value : startCol.value)

  // Simplified: single rectangle from start to end
  const top = r1 * charHeight
  const height = (r2 - r1 + 1) * charHeight
  const left = r1 === r2 ? c1 * charWidth : 0
  const width = r1 === r2 ? (c2 - c1 + 1) * charWidth : (termRect?.width || 0)

  return {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
})

function getSelectedText(): string {
  if (!xterm) return ''
  const buffer = xterm.buffer.active
  const r1 = Math.min(startRow.value, endRow.value)
  const r2 = Math.max(startRow.value, endRow.value)

  let text = ''
  for (let r = r1; r <= r2; r++) {
    const line = buffer.getLine(r + buffer.viewportY)
    if (!line) continue
    const lineText = line.translateToString(true)
    if (r1 === r2) {
      const c1 = Math.min(startCol.value, endCol.value)
      const c2 = Math.max(startCol.value, endCol.value)
      text += lineText.slice(c1, c2 + 1)
    } else {
      text += lineText
      if (r < r2) text += '\n'
    }
  }
  return text
}

async function doCopy() {
  const text = getSelectedText()
  if (text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
  }
  cancel()
}

function doSelectAll() {
  if (!xterm) return
  startRow.value = 0
  startCol.value = 0
  endRow.value = xterm.rows - 1
  endCol.value = xterm.cols - 1
}

defineExpose({ activate, cancel, active })
</script>

<style scoped>
.selection-overlay {
  position: absolute;
  inset: 0;
  z-index: 200;
  touch-action: none;
}

.selection-highlight {
  position: absolute;
  background: rgba(77, 127, 255, 0.3);
  border-radius: 2px;
  pointer-events: none;
}

.selection-toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.selection-toolbar button {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--fg-bright);
  background: rgba(255,255,255,0.08);
}
.selection-toolbar button:hover {
  background: rgba(255,255,255,0.15);
}
</style>
