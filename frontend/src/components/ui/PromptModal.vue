<template>
  <Teleport to="body">
    <div v-if="visible" class="prompt-backdrop" @click.self="onCancel">
      <div ref="rootEl" class="prompt-modal">
        <div class="prompt-header">
          <span class="prompt-title">{{ title }}</span>
          <button class="prompt-close" @click="onCancel">&times;</button>
        </div>
        <div class="prompt-body">
          <input
            ref="inputRef"
            v-model="inputValue"
            class="prompt-input"
            :placeholder="placeholder"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="prompt-footer">
          <button class="prompt-btn cancel" @click="onCancel">{{ cancelText }}</button>
          <button class="prompt-btn primary" :disabled="!canSubmit" @click="onConfirm">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
const visibleStack: symbol[] = []
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title: string
  defaultValue: string
  placeholder: string
  confirmText: string
  cancelText: string
}>()

const emit = defineEmits<{
  confirm: [value: string]
  cancel: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const inputValue = ref('')
const stackId = Symbol()

const canSubmit = computed(() => inputValue.value.trim().length > 0)

function removeFromVisibleStack() {
  const index = visibleStack.indexOf(stackId)
  if (index !== -1) visibleStack.splice(index, 1)
}

watch(
  () => props.visible,
  (visible) => {
    removeFromVisibleStack()
    if (visible) {
      inputValue.value = props.defaultValue
      visibleStack.push(stackId)
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  },
  { immediate: true }
)

function onConfirm() {
  if (!canSubmit.value) return
  emit('confirm', inputValue.value)
}

function onCancel() {
  emit('cancel')
}

function onKey(e: KeyboardEvent) {
  if (!props.visible) return
  if (visibleStack[visibleStack.length - 1] !== stackId) return
  const isIme = e.isComposing || e.keyCode === 229 || e.key === 'Process'
  if (isIme) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    onConfirm()
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  removeFromVisibleStack()
  window.removeEventListener('keydown', onKey, true)
})
</script>

<style scoped>
.prompt-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.prompt-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90vw;
  max-width: 380px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}

.prompt-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}

.prompt-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--fg-muted);
  background: none;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}

.prompt-close:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.prompt-body {
  padding: 10px 16px;
}

.prompt-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  font: inherit;
  font-size: 16px;
  padding: 8px 10px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.prompt-input:focus {
  border-color: var(--accent);
}

.prompt-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}

.prompt-btn {
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

.prompt-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.prompt-btn.primary {
  background: var(--accent);
  color: #fff;
}

.prompt-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.prompt-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>
