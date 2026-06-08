<template>
  <div
    class="pane-header"
    :class="[direction ? `direction-${direction}` : '', { active: isActive, dragging: isDragging, 'drag-over': dragOverPosition }]"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <span class="pane-header-drag-handle">&#x2630;</span>
    <span class="pane-header-title">{{ title }}</span>
    <!-- Drop position indicator -->
    <div v-if="dragOverPosition" :class="['drop-indicator', dragOverPosition]" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  paneId: string
  title: string
  isActive: boolean
  direction?: 'horizontal' | 'vertical'
}>()

const emit = defineEmits<{
  reorder: [sourcePaneId: string, targetPaneId: string, position: 'before' | 'after']
}>()

const isDragging = ref(false)
const dragOverPosition = ref<'before' | 'after' | null>(null)

function onDragStart(e: DragEvent) {
  isDragging.value = true
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', props.paneId)
}

function onDragEnd() {
  isDragging.value = false
  clearAllDropIndicators()
}

function onDragOver(e: DragEvent) {
  const sourceId = e.dataTransfer!.types.includes('text/plain') ? 'text/plain' : null
  if (!sourceId) return

  // Don't show indicator when dragging over self
  const draggedId = e.dataTransfer!.getData('text/plain')
  if (draggedId === props.paneId) {
    dragOverPosition.value = null
    return
  }

  e.dataTransfer!.dropEffect = 'move'

  // Determine if cursor is in top/left half or bottom/right half
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const midX = rect.left + rect.width / 2
  const midY = rect.top + rect.height / 2

  // Use both axes to determine position
  const inTopHalf = e.clientY < midY
  const inLeftHalf = e.clientX < midX

  // Prefer vertical ordering when cursor is clearly in top/bottom half
  const verticalDist = Math.abs(e.clientY - midY) / rect.height
  const horizontalDist = Math.abs(e.clientX - midX) / rect.width

  if (verticalDist > horizontalDist) {
    dragOverPosition.value = inTopHalf ? 'before' : 'after'
  } else {
    dragOverPosition.value = inLeftHalf ? 'before' : 'after'
  }
}

function onDragLeave() {
  dragOverPosition.value = null
}

function onDrop(e: DragEvent) {
  const sourceId = e.dataTransfer!.getData('text/plain')
  if (!sourceId || sourceId === props.paneId) {
    dragOverPosition.value = null
    return
  }

  const position = dragOverPosition.value ?? 'after'
  emit('reorder', sourceId, props.paneId, position)
  dragOverPosition.value = null
}

function clearAllDropIndicators() {
  document.querySelectorAll('.pane-header.drag-over').forEach(el => {
    (el as HTMLElement).classList.remove('drag-over')
  })
}
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

.pane-header.drag-over {
  background: var(--accent-color-alpha, rgba(77, 128, 255, 0.1));
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

/* Drop position indicator line */
.drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-color, #4d80ff);
  z-index: 10;
  pointer-events: none;
}

.drop-indicator.before {
  top: -1px;
}

.drop-indicator.after {
  bottom: -1px;
}
</style>
