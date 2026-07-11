<template>
  <div
    class="pane-header"
    :class="[direction ? `direction-${direction}` : '', { active: isActive, dragging: isDragging }]"
    @mousedown.prevent="onMouseDown"
    @touchstart.prevent="onTouchStart"
  >
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
let isTouchDrag = false
const DRAG_THRESHOLD = 5

function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0]
    return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: e.clientX, clientY: e.clientY }
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  startDrag(e, false)
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  startDrag(e, true)
}

function startDrag(e: MouseEvent | TouchEvent, isTouch: boolean) {
  const pos = getPointerPos(e)
  startX = pos.clientX
  startY = pos.clientY
  dragStarted = false
  isTouchDrag = isTouch

  const moveEvent = isTouch ? 'touchmove' : 'mousemove'
  const endEvent = isTouch ? 'touchend' : 'mouseup'

  window.addEventListener(
    moveEvent,
    onPointerMove as EventListener,
    { passive: !isTouch } as AddEventListenerOptions
  )
  window.addEventListener(endEvent, onPointerEnd)
}

function ensureDragStarted() {
  if (dragStarted) return
  dragStarted = true
  isDragging.value = true

  // On touch, skip overlay to avoid blocking touch events
  if (!isTouchDrag) {
    overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:grabbing;'
    document.body.appendChild(overlay)
  }

  // Create red preview div (hidden initially)
  preview = document.createElement('div')
  preview.style.cssText =
    'position:fixed;z-index:10000;background:rgba(239,68,68,0.3);pointer-events:none;display:none;border-radius:2px;'
  document.body.appendChild(preview)
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  const pos = getPointerPos(e)
  // Wait for movement threshold before starting drag
  if (!dragStarted) {
    if (
      Math.abs(pos.clientX - startX) < DRAG_THRESHOLD &&
      Math.abs(pos.clientY - startY) < DRAG_THRESHOLD
    ) {
      return
    }
    ensureDragStarted()
  }

  if (!preview) return

  // Find target pane under cursor
  const elements = document.elementsFromPoint(pos.clientX, pos.clientY)
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
  const relX = (pos.clientX - rect.left) / rect.width
  const relY = (pos.clientY - rect.top) / rect.height

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

function onPointerEnd() {
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

  window.removeEventListener('mousemove', onPointerMove as EventListener)
  window.removeEventListener('mouseup', onPointerEnd)
  window.removeEventListener('touchmove', onPointerMove as EventListener)
  window.removeEventListener('touchend', onPointerEnd)
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
  background: var(--bg-secondary, var(--bg-surface));
  border-bottom: 1px solid var(--border-color, var(--border));
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
  background: var(--bg-tertiary, var(--bg-hover));
}

.pane-header.dragging {
  opacity: 0.5;
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
