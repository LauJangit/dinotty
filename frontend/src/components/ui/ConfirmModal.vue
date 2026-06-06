<template>
  <Teleport to="body">
    <div v-if="visible" class="confirm-backdrop" @click.self="onCancel">
      <div class="confirm-modal">
        <div class="confirm-header">
          <span class="confirm-title">{{ title }}</span>
          <button class="confirm-close" @click="onCancel">&times;</button>
        </div>
        <div class="confirm-body">
          <p class="confirm-message">{{ message }}</p>
          <p v-if="target" class="confirm-target">{{ target }}</p>
        </div>
        <div class="confirm-footer">
          <button class="confirm-btn cancel" @click="onCancel">{{ cancelText }}</button>
          <button class="confirm-btn primary" @click="onConfirm">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  message: string
  target?: string
  confirmText: string
  cancelText: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
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
  background: rgba(255, 255, 255, 0.08);
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

.confirm-target {
  margin-top: 6px;
  font-size: 12px;
  color: var(--accent);
  word-break: break-all;
  font-family: var(--font-mono);
  background: var(--bg-input);
  padding: 6px 8px;
  border-radius: 4px;
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
  transition: background 0.15s, color 0.15s;
}

.confirm-btn.cancel {
  background: none;
  color: var(--fg-muted);
}

.confirm-btn.cancel:hover {
  background: rgba(255,255,255,0.06);
  color: var(--fg);
}

.confirm-btn.primary {
  background: none;
  color: var(--color-red, #ef4444);
}

.confirm-btn.primary:hover {
  background: rgba(239,68,68,0.08);
  color: var(--color-red, #ef4444);
}
</style>
