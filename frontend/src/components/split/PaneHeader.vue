<template>
  <div
    class="pane-header"
    :class="[direction ? `direction-${direction}` : '', { active: isActive, dragging: isDragging }]"
    @mousedown.prevent="onMouseDown"
  >
    <span class="pane-header-drag-handle">&#x2630;</span>
    <span class="pane-header-title">{{ title }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import type { DropPosition } from '../../types/pane'

const props = defineProps<{
  paneId: string
  title: string
  isActive: boolean
  direction?: 'horizontal' | 'vertical'
}>()

const emit = defineEmits<{
  reorder: [sourcePaneId: string, targetPaneId: string, position: DropPosition]
}>()

const isDragging = ref(false)

let overlay: HTMLDivElement | null = null
let preview: HTMLDivElement | null = null
let currentTargetId: string | null = null
let currentZone: DropPosition | null = null
let dragStarted = false
let startX = 0
let startY = 0
const DRAG_THRESHOLD = 5

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  startX = e.clientX
  startY = e.clientY
  dragStarted = false

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function ensureDragStarted() {
  if (dragStarted) return
  dragStarted = true
  isDragging.value = true

  // Create full-viewport overlay to capture mouse events
  overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:grabbing;'
  document.body.appendChild(overlay)

  // Create red preview div (hidden initially)
  preview = document.createElement('div')
  preview.style.cssText = 'position:fixed;z-index:10000;background:rgba(239,68,68,0.3);pointer-events:none;display:none;border-radius:2px;'
  document.body.appendChild(preview)
}

function onMouseMove(e: MouseEvent) {
  // Wait for movement threshold before starting drag
  if (!dragStarted) {
    if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) {
      return
    }
    ensureDragStarted()
  }

  if (!overlay || !preview) return

  // Find target pane under cursor
  const elements = document.elementsFromPoint(e.clientX, e.clientY)
  let targetEl: HTMLElement | null = null
  for (const el of elements) {
    const htmlEl = el as HTMLElement
    // Skip overlay and preview
    if (htmlEl === overlay || htmlEl === preview) continue
    // Find nearest .split-leaf with data-pane-id
    const leaf = htmlEl.closest('.split-leaf[data-pane-id]') as HTMLElement | null
    if (leaf) {
      const paneId = leaf.dataset.paneId
      // Skip self
      if (paneId && paneId !== props.paneId) {
        targetEl = leaf
        break
      }
    }
  }

  if (!targetEl) {
    // No valid target — hide preview
    preview.style.display = 'none'
    currentTargetId = null
    currentZone = null
    return
  }

  const targetId = targetEl.dataset.paneId!
  const rect = targetEl.getBoundingClientRect()

  // Detect zone: each edge quarter
  const relX = (e.clientX - rect.left) / rect.width
  const relY = (e.clientY - rect.top) / rect.height

  let zone: DropPosition
  if (relY < 0.25) zone = 'top'
  else if (relY > 0.75) zone = 'bottom'
  else if (relX < 0.25) zone = 'left'
  else if (relX > 0.75) zone = 'right'
  else {
    // Center area — pick closest edge
    const distTop = relY
    const distBottom = 1 - relY
    const distLeft = relX
    const distRight = 1 - relX
    const minDist = Math.min(distTop, distBottom, distLeft, distRight)
    if (minDist === distTop) zone = 'top'
    else if (minDist === distBottom) zone = 'bottom'
    else if (minDist === distLeft) zone = 'left'
    else zone = 'right'
  }

  currentTargetId = targetId
  currentZone = zone

  // Position preview to cover half the target pane
  const halfW = rect.width / 2
  const halfH = rect.height / 2
  let left: number, top: number, w: number, h: number

  switch (zone) {
    case 'left':
      left = rect.left
      top = rect.top
      w = halfW
      h = rect.height
      break
    case 'right':
      left = rect.left + halfW
      top = rect.top
      w = halfW
      h = rect.height
      break
    case 'top':
      left = rect.left
      top = rect.top
      w = rect.width
      h = halfH
      break
    case 'bottom':
      left = rect.left
      top = rect.top + halfH
      w = rect.width
      h = halfH
      break
  }

  preview.style.display = 'block'
  preview.style.left = `${left}px`
  preview.style.top = `${top}px`
  preview.style.width = `${w}px`
  preview.style.height = `${h}px`
}

function onMouseUp() {
  // Only emit reorder if drag actually started and we have a valid target
  if (dragStarted && currentTargetId && currentZone) {
    emit('reorder', props.paneId, currentTargetId, currentZone)
  }

  cleanup()
}

function cleanup() {
  isDragging.value = false
  dragStarted = false
  currentTargetId = null
  currentZone = null

  overlay?.remove()
  overlay = null
  preview?.remove()
  preview = null

  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

onBeforeUnmount(() => {
  cleanup()
})
</script>

<style scoped>
.pane-header {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  background: var(--bg-secondary, #1e1e1e);
  border-bottom: 1px solid var(--border-color, #333);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  position: relative;
  transition: background 0.15s;
}

.pane-header.direction-vertical {
  padding: 8px 8px;
  height: auto;
}

.pane-header:active {
  cursor: grabbing;
}

.pane-header.active {
  background: var(--bg-tertiary, #252525);
}

.pane-header.dragging {
  opacity: 0.5;
}

.pane-header-drag-handle {
  font-size: 12px;
  color: var(--text-tertiary, #666);
  margin-right: 6px;
  opacity: 0.6;
}

.pane-header-title {
  font-size: 11px;
  color: var(--text-secondary, #aaa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-header.active .pane-header-title {
  color: var(--text-primary, #fff);
}
</style>
