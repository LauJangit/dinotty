<template>
  <Teleport to="body">
    <template v-if="visible">
      <!-- Full-screen overlay only during drag to block terminal interaction -->
      <div v-if="dragging" class="sel-handles-overlay" />
      <div
        class="sel-handle sel-handle--start"
        :style="startStyle"
        @mousedown.prevent="onMouseDown($event, 'start')"
        @touchstart.prevent="onTouchStart($event, 'start')"
      >
        <div class="sel-handle__knob" />
      </div>
      <div
        class="sel-handle sel-handle--end"
        :style="endStyle"
        @mousedown.prevent="onMouseDown($event, 'end')"
        @touchstart.prevent="onTouchStart($event, 'end')"
      >
        <div class="sel-handle__knob" />
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = defineProps<{
  visible: boolean
  startX: number
  startY: number
  endX: number
  endY: number
}>()

const emit = defineEmits<{
  drag: [handle: 'start' | 'end', clientX: number, clientY: number]
  dragEnd: [canceled: boolean]
}>()

const dragging = ref(false)
const activeHandle = ref<'start' | 'end' | null>(null)

const startStyle = computed(() => ({
  left: `${props.startX - 10}px`,
  top: `${props.startY}px`,
}))

const endStyle = computed(() => ({
  left: `${props.endX - 10}px`,
  top: `${props.endY}px`,
}))

function getPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e && e.touches.length) return e.touches[0]
  if ('changedTouches' in e && e.changedTouches.length) return e.changedTouches[0]
  return e as MouseEvent
}

function onMouseDown(e: MouseEvent, handle: 'start' | 'end') {
  startDrag(handle, e)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onEnd)
}

function onTouchStart(e: TouchEvent, handle: 'start' | 'end') {
  startDrag(handle, e)
  window.addEventListener('touchmove', onMove, { passive: false })
  window.addEventListener('touchend', onEnd)
  window.addEventListener('touchcancel', onEnd)
}

function startDrag(handle: 'start' | 'end', e: MouseEvent | TouchEvent) {
  activeHandle.value = handle
  dragging.value = true
  const pos = getPos(e)
  emit('drag', handle, pos.clientX, pos.clientY)
}

function onMove(e: MouseEvent | TouchEvent) {
  if ('touches' in e) e.preventDefault() // block scroll
  if (!activeHandle.value) return
  const pos = getPos(e)
  emit('drag', activeHandle.value, pos.clientX, pos.clientY)
}

function onEnd(e?: Event) {
  dragging.value = false
  activeHandle.value = null
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onEnd)
  window.removeEventListener('touchmove', onMove)
  window.removeEventListener('touchend', onEnd)
  window.removeEventListener('touchcancel', onEnd)
  emit('dragEnd', e?.type === 'touchcancel')
}

// Safety net: if the component unmounts mid-drag, onEnd may never fire — remove
// any window listeners so their closures don't leak or emit into a dead parent (DT8 #4).
onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onEnd)
  window.removeEventListener('touchmove', onMove)
  window.removeEventListener('touchend', onEnd)
  window.removeEventListener('touchcancel', onEnd)
})
</script>

<style scoped>
.sel-handles-overlay {
  position: fixed;
  inset: 0;
  z-index: 100002;
}

.sel-handle {
  position: fixed;
  z-index: 100003;
  touch-action: none;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}

.sel-handle:active {
  cursor: grabbing;
}

/* Start handle: knob at top, line extends upward */
.sel-handle--start {
  flex-direction: column;
}

.sel-handle--start::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 100%;
  background: var(--accent, #4d7fff);
  border-radius: 1px;
}

/* End handle: knob at bottom, line extends downward */
.sel-handle--end {
  flex-direction: column;
}

.sel-handle--end::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 100%;
  background: var(--accent, #4d7fff);
  border-radius: 1px;
}

.sel-handle__knob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent, #4d7fff);
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  transition: transform 0.15s ease;
}

.sel-handle:active .sel-handle__knob {
  transform: scale(1.3);
}
</style>
