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
        <div v-else class="file-preview-content" ref="contentRef">
          <table class="file-preview-table">
            <tr v-for="(line, i) in lines" :key="i">
              <td class="line-no">{{ i + 1 }}</td>
              <td class="line-code" v-html="line"></td>
            </tr>
          </table>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import hljs from 'highlight.js/lib/core'

// Register common languages
import rust from 'highlight.js/lib/languages/rust'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import cpp from 'highlight.js/lib/languages/cpp'
import java from 'highlight.js/lib/languages/java'

hljs.registerLanguage('rust', rust)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('go', go)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('java', java)

const visible = ref(false)
const filePath = ref('')
const loading = ref(false)
const error = ref('')
const lines = ref<string[]>([])
const contentRef = ref<HTMLElement>()

async function open(path: string) {
  filePath.value = path
  visible.value = true
  loading.value = true
  error.value = ''
  lines.value = []

  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      const data = await res.json()
      error.value = data.error || 'Failed to load file'
      return
    }
    const data = await res.json()
    const highlighted = highlightCode(data.content, data.language)
    lines.value = highlighted.split('\n')
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

function highlightCode(code: string, language: string): string {
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value
    }
  } catch {}
  return escHtml(code)
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

.file-preview-content {
  flex: 1;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
}

.file-preview-table {
  border-collapse: collapse;
  width: 100%;
}
.file-preview-table tr:hover {
  background: rgba(255,255,255,0.03);
}

.line-no {
  padding: 0 12px;
  text-align: right;
  color: var(--fg-muted, #666);
  user-select: none;
  white-space: nowrap;
  vertical-align: top;
  font-size: 12px;
  border-right: 1px solid var(--border, #333);
}

.line-code {
  padding: 0 16px;
  white-space: pre;
  color: var(--fg, #C7C7C7);
}

/* highlight.js token colors */
.line-code :deep(.hljs-keyword) { color: var(--color-magenta, #CA30C7); }
.line-code :deep(.hljs-string) { color: var(--color-green, #00C200); }
.line-code :deep(.hljs-number) { color: var(--color-yellow, #C7C400); }
.line-code :deep(.hljs-comment) { color: var(--fg-muted, #666); font-style: italic; }
.line-code :deep(.hljs-function) { color: var(--color-blue, #0225C7); }
.line-code :deep(.hljs-title) { color: var(--color-cyan, #00C5C7); }
.line-code :deep(.hljs-type) { color: var(--color-yellow, #C7C400); }
.line-code :deep(.hljs-built_in) { color: var(--color-cyan, #00C5C7); }
.line-code :deep(.hljs-literal) { color: var(--color-red, #C91B00); }
.line-code :deep(.hljs-attr) { color: var(--color-yellow, #C7C400); }
.line-code :deep(.hljs-selector-class) { color: var(--color-green, #00C200); }
.line-code :deep(.hljs-selector-tag) { color: var(--color-red, #C91B00); }
</style>
