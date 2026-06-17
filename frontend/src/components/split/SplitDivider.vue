<template>
  <div
    :class="['split-divider', direction]"
    @mousedown.prevent="onDragStart"
    @touchstart.prevent="onTouchStart"
    @dblclick="onDoubleClick"
  />
</template>

<script setup lang="ts">
import type { Ref } from 'vue'

const props = defineProps<{
  direction: 'horizontal' | 'vertical'
  leftRatioRef: Ref<number>
  rightRatioRef: Ref<number>
  containerEl: HTMLElement
}>()

const emit = defineEmits<{
  'drag-end': []
}>()

function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0]
    return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: e.clientX, clientY: e.clientY }
}

function onDragStart(e: MouseEvent) {
  startDrag(e)
}

function onTouchStart(e: TouchEvent) {
  startDrag(e)
}

function startDrag(e: MouseEvent | TouchEvent) {
  const isTouch = 'touches' in e
  const horiz = props.direction === 'horizontal'

  const overlay = isTouch ? null : (() => {
    const d = document.createElement('div')
    d.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${horiz ? 'col-resize' : 'row-resize'};`
    document.body.appendChild(d)
    return d
  })()

  const onMove = (ev: MouseEvent | TouchEvent) => {
    if ('touches' in ev) ev.preventDefault()
    const pos = getPointerPos(ev)
    const rect = props.containerEl.getBoundingClientRect()
    const total = horiz ? rect.width : rect.height
    const offset = horiz ? pos.clientX - rect.left : pos.clientY - rect.top
    const pct = offset / total

    const sum = props.leftRatioRef.value + props.rightRatioRef.value
    const minRatio = 0.1
    const newLeft = Math.max(minRatio, Math.min(sum - minRatio, pct))

    props.leftRatioRef.value = newLeft
    props.rightRatioRef.value = sum - newLeft
  }

  const moveEvent = isTouch ? 'touchmove' : 'mousemove'
  const endEvent = isTouch ? 'touchend' : 'mouseup'

  const onEnd = () => {
    overlay?.remove()
    window.removeEventListener(moveEvent, onMove as EventListener)
    window.removeEventListener(endEvent, onEnd)
    window.dispatchEvent(new Event('resize'))
    emit('drag-end')
  }

  window.addEventListener(moveEvent, onMove as EventListener, { passive: !isTouch } as AddEventListenerOptions)
  window.addEventListener(endEvent, onEnd)
}

function onDoubleClick() {
  const sum = props.leftRatioRef.value + props.rightRatioRef.value
  props.leftRatioRef.value = sum / 2
  props.rightRatioRef.value = sum / 2
}
</script>

<style scoped>
.split-divider {
  flex: 0 0 5px;
  background: var(--border-color, #333);
  transition: background 0.15s;
  z-index: 5;
  position: relative;
  /* Expand touch target area for mobile — visual size stays 5px */
  touch-action: none;
}

.split-divider::before {
  content: '';
  position: absolute;
  z-index: 6;
}

.split-divider.horizontal::before {
  top: -10px;
  bottom: -10px;
  left: -10px;
  right: -10px;
}

.split-divider.vertical::before {
  top: -10px;
  bottom: -10px;
  left: -10px;
  right: -10px;
}

.split-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 0.15s;
}

.split-divider.horizontal::after {
  width: 1px;
  height: 16px;
}

.split-divider.vertical::after {
  width: 16px;
  height: 1px;
}

.split-divider:hover::after {
  opacity: 1;
  background: var(--text-secondary, #888);
}

.split-divider:hover,
.split-divider.dragging {
  background: var(--accent-color, #4d80ff);
}

.split-divider.horizontal {
  cursor: col-resize;
}

.split-divider.vertical {
  cursor: row-resize;
}
</style>
