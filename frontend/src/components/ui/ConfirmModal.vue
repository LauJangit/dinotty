<template>
  <Teleport to="body">
    <div v-if="visible" class="confirm-backdrop" @click.self="onCancel">
      <div ref="rootEl" class="confirm-modal">
        <div class="confirm-header">
          <span class="confirm-title">{{ title }}</span>
          <button class="confirm-close" @click="onCancel">&times;</button>
        </div>
        <div class="confirm-body">
          <p class="confirm-message">{{ message }}</p>
        </div>
        <div class="confirm-footer">
          <button class="confirm-btn cancel" :class="{ focused: focusIndex === 0 }" @click="onCancel">{{ cancelText }}</button>
          <button class="confirm-btn primary" :class="{ focused: focusIndex === 1 }" @click="onConfirm">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
const visibleStack: symbol[] = []
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { settings } from '../../composables/useSettings'

const props = defineProps<{
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const focusIndex = ref(0)
const rootEl = ref<HTMLElement | null>(null)
const stackId = Symbol()
const spaceConfirmIssued = ref(false)

function removeFromVisibleStack() {
  const index = visibleStack.indexOf(stackId)
  if (index !== -1) visibleStack.splice(index, 1)
}

watch(
  () => props.visible,
  (visible) => {
    removeFromVisibleStack()
    if (visible) {
      focusIndex.value = 0
      spaceConfirmIssued.value = false
      visibleStack.push(stackId)
    }
  },
  { immediate: true }
)

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}

function onKey(e: KeyboardEvent) {
  if (!props.visible) return
  const isIme = e.isComposing || e.keyCode === 229 || e.key === 'Process'
  if (
    settings.space_confirms_dialogs &&
    e.key === ' ' &&
    !isIme &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey
  ) {
    if (visibleStack[visibleStack.length - 1] !== stackId) return

    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      rootEl.value?.contains(activeElement) &&
      (activeElement.matches('button, input, textarea, select, [contenteditable]') ||
        activeElement.isContentEditable)
    ) {
      return
    }

    e.preventDefault()
    e.stopImmediatePropagation()
    if (!spaceConfirmIssued.value) {
      spaceConfirmIssued.value = true
      onConfirm()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    focusIndex.value = focusIndex.value === 0 ? 1 : 0
  } else if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    if (focusIndex.value === 0) onCancel()
    else onConfirm()
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  removeFromVisibleStack()
  window.removeEventListener('keydown', onKey, true)
})
</script>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90vw;
  max-width: 380px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.confirm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}

.confirm-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}

.confirm-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--fg-muted);
  transition: background 0.15s;
}

.confirm-close:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.confirm-body {
  padding: 10px 16px;
}

.confirm-message {
  font-size: 13px;
  color: var(--fg);
  line-height: 1.5;
}

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}

.confirm-btn {
  padding: 6px 16px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  color: var(--fg-muted);
  background: none;
  transition:
    background 0.15s,
    color 0.15s;
}

.confirm-btn.cancel {
  background: none;
  color: var(--fg-muted);
}

.confirm-btn.cancel:hover,
.confirm-btn.cancel.focused {
  background: var(--bg-hover);
  color: var(--fg);
}

.confirm-btn.cancel.focused {
  outline: 1px solid var(--fg-muted);
  outline-offset: -1px;
}

.confirm-btn.primary {
  background: none;
  color: var(--color-red, #ef4444);
}

.confirm-btn.primary:hover,
.confirm-btn.primary.focused {
  background: rgba(239, 68, 68, 0.08);
  color: var(--color-red, #ef4444);
}

.confirm-btn.primary.focused {
  outline: 1px solid var(--color-red, #ef4444);
  outline-offset: -1px;
}
</style>
