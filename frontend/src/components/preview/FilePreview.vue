<template>
  <Teleport to="body">
    <div v-if="visible" class="file-preview-backdrop" @click.self="close">
      <div class="file-preview-panel">
        <div class="file-preview-header">
          <span class="file-preview-path" :title="filePath">{{ filePath }}</span>
          <button class="file-preview-copy" @click="copyPath" title="Copy path">📋</button>
          <button class="file-preview-close" @click="close">✕</button>
        </div>
        <div v-if="loading" class="file-preview-loading">Loading...</div>
        <div v-else-if="error" class="file-preview-error">{{ error }}</div>
        <MonacoEditor
          v-else
          :model-value="content"
          :language="language"
          :readonly="true"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
const MonacoEditor = defineAsyncComponent(() => import('../workspace/MonacoEditor.vue'))

const visible = ref(false)
const filePath = ref('')
const loading = ref(false)
const error = ref('')
const content = ref('')
const language = ref('plaintext')

async function open(path: string) {
  filePath.value = path
  visible.value = true
  loading.value = true
  error.value = ''
  content.value = ''

  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      const data = await res.json()
      error.value = data.error || 'Failed to load file'
      return
    }
    const data = await res.json()
    content.value = data.content
    language.value = data.language || 'plaintext'
  } catch (e) {
    error.value = 'Network error'
  } finally {
    loading.value = false
  }
}

function close() {
  visible.value = false
}

function copyPath() {
  navigator.clipboard.writeText(filePath.value)
}

defineExpose({ open, close })
</script>

<style scoped>
.file-preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  z-index: 950;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-preview-panel {
  width: 90vw;
  max-width: 800px;
  height: 80vh;
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
}

.file-preview-path {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-bright, #F0F6FC);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-preview-copy,
.file-preview-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--fg-muted, #666);
}
.file-preview-copy:hover,
.file-preview-close:hover {
  background: rgba(255,255,255,0.1);
  color: var(--fg-bright);
}

.file-preview-loading,
.file-preview-error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #666);
  font-size: 14px;
}
.file-preview-error {
  color: var(--color-red, #C91B00);
}
</style>
