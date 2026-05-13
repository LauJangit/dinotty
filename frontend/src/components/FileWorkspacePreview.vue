<template>
  <div v-if="visible && embedded" class="file-workspace-embedded">
    <input ref="fileInputRef" type="file" multiple class="sr-only" @change="onFilePick" />
    <div ref="fileWorkspaceBodyRef" class="file-workspace-body" :class="{ 'drawer-mode': narrow, embedded }"
      @dragover.prevent
      @dragenter.prevent="dragCounter++"
      @dragleave="dragCounter = Math.max(0, dragCounter - 1)"
      @drop.prevent="dragCounter = 0; onDrop($event)"
    >
      <div v-if="dragging" class="file-workspace-drop-overlay">{{ t('filePreview.dropHint') }}</div>
      <div
        v-if="(narrow && drawerOpen) || (!narrow && !treeCollapsed)"
        class="file-workspace-tree-wrap"
        :class="{ drawer: narrow }"
        :style="treeWrapStyle"
        @click.self="narrow && tryCloseDrawerFromChrome()"
      >
        <div class="file-workspace-tree" @click.stop @pointerdown.capture="bumpTreePointerTs" @contextmenu.prevent="onTreeBgContextMenu">
          <TreeRows
            :pane-id="paneId"
            :depth="0"
            rel-path=""
            :workspace-root="cwdLabel"
            :cache="childCache"
            :expanded="expanded"
            :selected-rel="selectedRel ?? undefined"
            :inline-create="inlineCreateForTree"
            :inline-placeholder="inlineInputPlaceholder"
            :inline-rename="inlineRename ?? undefined"
            @toggle="onToggle"
            @select-file="trySelectFile"
            @select-dir="trySelectDir"
            @inline-create-commit="onInlineCreateCommit"
            @inline-create-cancel="onInlineCreateCancel"
            @inline-rename-commit="onInlineRenameCommit"
            @inline-rename-cancel="onInlineRenameCancel"
            @context-menu="onTreeContextMenu"
            @long-press="onTreeLongPress"
            @move-entry="onMoveEntry"
          />
        </div>
      </div>
      <div
        v-if="!narrow && !treeCollapsed"
        class="file-workspace-tree-splitter"
        @mousedown.prevent="startTreeWidthDrag"
        @touchstart.prevent="startTreeWidthDragTouch"
      ></div>
      <button
        v-if="!narrow && treeCollapsed"
        type="button"
        class="file-workspace-tree-reveal"
        :title="t('previewPanel.expandTree')"
        @click="treeCollapsed = false"
      >
        ▶
      </button>
      <div v-if="narrow && drawerOpen" class="file-workspace-overlay" @click="tryCloseDrawerFromChrome"></div>
      <FilePreviewContent
        ref="previewContentRef1"
        :preview-loading="previewLoading"
        :preview-err="previewErr"
        :selected-rel="selectedRel"
        :selected-is-dir="selectedIsDir"
        :meta="meta"
        :raw-url="rawUrl"
        :show-save="false"
        :audio-title="audioTitle"
        :audio-sub="audioSub"
        :audio-time-now="audioTimeNow"
        :audio-time-total="audioTimeTotal"
        :audio-seek-value="audioSeekValue"
        :audio-vol-value="audioVolValue"
        :audio-playing="audioPlaying"
        :editor-dirty="editorDirty"
        :editor-text="editorText"
        :can-save-editor="canSaveEditor"
        :md-show-preview="mdShowPreview"
        :markdown-editor-html="markdownEditorHtml"
        :code-lines="codeLines"
        :highlighted-html="highlightedHtml"
        :office-loading="officeLoading"
        :office-err="officeErr"
        :office-html="officeHtml"
        @audio-time-update="onAudioTimeUpdate"
        @audio-loaded-metadata="onAudioLoadedMetadata"
        @audio-ended="onAudioEnded"
        @audio-seek-input="onAudioSeekInput"
        @seek-audio="seekAudio"
        @toggle-audio="toggleAudio"
        @audio-volume-input="onAudioVolumeInput"
        @update:md-show-preview="mdShowPreview = $event"
        @update:editor-text="editorText = $event"
        @editor-scroll="onEditorScroll"
      />
    </div>
  </div>
  <div v-else-if="visible" class="file-workspace" :class="direction">
    <div
      class="file-workspace-divider"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDrag"
    ></div>
    <div class="file-workspace-panel">
      <div class="file-workspace-toolbar">
        <button type="button" :disabled="!canGoBack" @click="goBack" title="Back">←</button>
        <button type="button" :disabled="!canGoForward" @click="goForward" title="Forward">→</button>
        <button type="button" @click="reloadAll" title="Refresh">↻</button>
        <span class="file-workspace-cwd" :title="cwdLabel">{{ cwdShort }}</span>
        <div class="file-workspace-add-menu">
          <button type="button" @click="addMenuOpen = !addMenuOpen" title="New">+</button>
          <div v-if="addMenuOpen" class="file-workspace-add-backdrop" @click="addMenuOpen = false"></div>
          <div v-if="addMenuOpen" class="file-workspace-add-dropdown">
            <button type="button" @click="addMenuOpen = false; startNewFile()">{{ t('filePreview.ctxNewFile') }}</button>
            <button type="button" @click="addMenuOpen = false; startNewFolder()">{{ t('filePreview.ctxNewFolder') }}</button>
          </div>
        </div>
        <button type="button" @click="triggerUpload()" title="Upload">↑</button>
        <button type="button" :disabled="!canDownload" @click="downloadSelected" title="Download">↓</button>
        <button
          v-if="!narrow"
          type="button"
          class="file-workspace-drawer-btn"
          :title="treeCollapsed ? t('previewPanel.expandTree') : t('previewPanel.collapseTree')"
          @click="treeCollapsed = !treeCollapsed"
        >
          {{ treeCollapsed ? '▶' : '◀' }}
        </button>
        <button
          v-if="narrow"
          type="button"
          class="file-workspace-drawer-btn"
          :title="drawerOpen ? t('previewPanel.collapseTree') : t('previewPanel.expandTree')"
          @click="toggleDrawer"
        >
          {{ drawerOpen ? '◀' : '▶' }}
        </button>
        <button type="button" @click="close" title="Close">✕</button>
      </div>
      <input ref="fileInputRef" type="file" multiple class="sr-only" @change="onFilePick" />
      <div ref="fileWorkspaceBodyRef" class="file-workspace-body" :class="{ 'drawer-mode': narrow }"
        @dragover.prevent
        @dragenter.prevent="dragCounter++"
        @dragleave="dragCounter = Math.max(0, dragCounter - 1)"
        @drop.prevent="dragCounter = 0; onDrop($event)"
      >
        <div v-if="dragging" class="file-workspace-drop-overlay">{{ t('filePreview.dropHint') }}</div>
        <div
          v-if="(narrow && drawerOpen) || (!narrow && !treeCollapsed)"
          class="file-workspace-tree-wrap"
          :class="{ drawer: narrow }"
          :style="treeWrapStyle"
          @click.self="narrow && tryCloseDrawerFromChrome()"
        >
          <div class="file-workspace-tree" @click.stop @pointerdown.capture="bumpTreePointerTs" @contextmenu.prevent="onTreeBgContextMenu">
            <TreeRows
              :pane-id="paneId"
              :depth="0"
              rel-path=""
              :workspace-root="cwdLabel"
              :cache="childCache"
              :expanded="expanded"
              :selected-rel="selectedRel ?? undefined"
              :inline-create="inlineCreateForTree"
              :inline-placeholder="inlineInputPlaceholder"
              @toggle="onToggle"
              @select-file="trySelectFile"
              @select-dir="trySelectDir"
              @inline-create-commit="onInlineCreateCommit"
              @inline-create-cancel="onInlineCreateCancel"
              @context-menu="onTreeContextMenu"
              @long-press="onTreeLongPress"
              @move-entry="onMoveEntry"
            />
          </div>
        </div>
        <div
          v-if="!narrow && !treeCollapsed"
          class="file-workspace-tree-splitter"
          @mousedown.prevent="startTreeWidthDrag"
          @touchstart.prevent="startTreeWidthDragTouch"
        ></div>
        <button
          v-if="!narrow && treeCollapsed"
          type="button"
          class="file-workspace-tree-reveal"
          :title="t('previewPanel.expandTree')"
          @click="treeCollapsed = false"
        >
          ▶
        </button>
        <div v-if="narrow && drawerOpen" class="file-workspace-overlay" @click="tryCloseDrawerFromChrome"></div>
        <FilePreviewContent
          ref="previewContentRef2"
          :preview-loading="previewLoading"
          :preview-err="previewErr"
          :selected-rel="selectedRel"
          :selected-is-dir="selectedIsDir"
          :meta="meta"
          :raw-url="rawUrl"
          :show-save="true"
          :audio-title="audioTitle"
          :audio-sub="audioSub"
          :audio-time-now="audioTimeNow"
          :audio-time-total="audioTimeTotal"
          :audio-seek-value="audioSeekValue"
          :audio-vol-value="audioVolValue"
          :audio-playing="audioPlaying"
          :editor-dirty="editorDirty"
          :editor-text="editorText"
          :can-save-editor="canSaveEditor"
          :md-show-preview="mdShowPreview"
          :markdown-editor-html="markdownEditorHtml"
          :code-lines="codeLines"
          :highlighted-html="highlightedHtml"
          :office-loading="officeLoading"
          :office-err="officeErr"
          :office-html="officeHtml"
          @audio-time-update="onAudioTimeUpdate"
          @audio-loaded-metadata="onAudioLoadedMetadata"
          @audio-ended="onAudioEnded"
          @audio-seek-input="onAudioSeekInput"
          @seek-audio="seekAudio"
          @toggle-audio="toggleAudio"
          @audio-volume-input="onAudioVolumeInput"
          @update:md-show-preview="mdShowPreview = $event"
          @save-editor="saveEditor"
          @update:editor-text="editorText = $event"
          @editor-scroll="onEditorScroll"
        />
      </div>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="contextMenu && visible"
      class="tree-ctx-backdrop"
      @mousedown="closeContextMenu"
      @touchstart="closeContextMenu"
    ></div>
    <div
      v-if="contextMenu && visible"
      class="tree-ctx-menu"
      :class="{ 'tree-ctx-menu--bottom': narrow }"
      role="menu"
      :style="contextMenuStyle"
      @mousedown.stop
      @touchstart.stop
    >
      <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxNewFile">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFile') }}</span>
      </button>
      <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxNewFolder">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFolder') }}</span>
      </button>
      <template v-if="contextMenu?.rel || selectedRel">
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          :disabled="!contextMenu?.rel && !selectedRel"
          @click="ctxRename"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxRename') }}</span>
          <span class="tree-ctx-kbd">F2</span>
        </button>
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item tree-ctx-item-danger"
          role="menuitem"
          :disabled="!contextMenu?.rel && !selectedRel"
          @click="ctxDelete"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDelete') }}</span>
          <span class="tree-ctx-kbd">{{ ctxDeleteKeyHint }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import hljs from 'highlight.js/lib/core'
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
import { useI18n } from '../composables/useI18n'
import { getApiBase, apiUrl, authFetch, wsUrlWithToken, getAuthToken } from '../composables/apiBase'
import { isNarrowViewport } from '../utils/viewport'
import { usePaneResize } from '../composables/usePaneResize'
import { TreeRows, TreeInlineInput, treeFolderIcon, treeFileIcon, absJoinWorkspaceRoot } from './workspace/TreeRows'
import type { DirEntry } from './workspace/TreeRows'
import FilePreviewContent from './workspace/FilePreviewContent.vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import officeParser from 'officeparser'

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

const props = withDefaults(
  defineProps<{ visible: boolean; paneId: string; embedded?: boolean }>(),
  { embedded: false },
)
const treeCollapsed = defineModel<boolean>('treeCollapsed', { default: false })
const emit = defineEmits<{ close: []; navigate: [path: string]; 'update:canGoBack': [v: boolean]; 'update:canGoForward': [v: boolean] }>()

const { t } = useI18n()

interface Meta {
  kind: string
  content?: string
  language?: string
  truncated?: boolean
  message?: string
}

const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set(['']))
const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)

const navHistory = ref<{ rel: string; isDir: boolean }[]>([])
const navIndex = ref(-1)
const navFromHistory = ref(false)
const canGoBack = computed(() => navIndex.value > 0)
const canGoForward = computed(() => navIndex.value < navHistory.value.length - 1)

watch(canGoBack, v => emit('update:canGoBack', v), { immediate: true })
watch(canGoForward, v => emit('update:canGoForward', v), { immediate: true })

function pushNav(rel: string, isDir: boolean) {
  if (navFromHistory.value) { navFromHistory.value = false; return }
  const cur = navHistory.value[navIndex.value]
  if (cur && cur.rel === rel && cur.isDir === isDir) return
  navHistory.value = navHistory.value.slice(0, navIndex.value + 1)
  navHistory.value.push({ rel, isDir })
  navIndex.value = navHistory.value.length - 1
}

function ensureParentsExpanded(rel: string) {
  const parts = rel.split('/')
  const next = new Set(expanded.value)
  next.add('')
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/')
    if (!next.has(ancestor)) {
      next.add(ancestor)
      void ensureChildren(ancestor)
    }
  }
  expanded.value = next
}

function goBack() {
  if (!canGoBack.value) return
  navFromHistory.value = true
  navIndex.value--
  const entry = navHistory.value[navIndex.value]
  ensureParentsExpanded(entry.rel)
  if (entry.isDir) onSelectDir(entry.rel)
  else void onSelectFile(entry.rel)
}

function goForward() {
  if (!canGoForward.value) return
  navFromHistory.value = true
  navIndex.value++
  const entry = navHistory.value[navIndex.value]
  ensureParentsExpanded(entry.rel)
  if (entry.isDir) onSelectDir(entry.rel)
  else void onSelectFile(entry.rel)
}
const meta = ref<Meta | null>(null)
const previewLoading = ref(false)
const previewErr = ref('')
const fileInputRef = ref<HTMLInputElement>()
const dragCounter = ref(0)
const dragging = computed(() => dragCounter.value > 0)
const drawerOpen = ref(isNarrowViewport())
const lastTreePointerTs = ref(0)
const officeLoading = ref(false)
const officeErr = ref('')
const officeHtml = ref('')
const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
const editorText = ref('')
const editorBaseline = ref('')
const mdShowPreview = ref(false)
const contextMenu = ref<{ x: number; y: number; rel: string; isDir: boolean } | null>(null)
const addMenuOpen = ref(false)

const ctxDeleteKeyHint = computed(() =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘⌫' : 'Del',
)

const contextMenuStyle = computed(() => {
  const m = contextMenu.value
  if (!m) return {}
  if (narrow.value) {
    return { left: '0', right: '0', bottom: '0' }
  }
  const pad = 8
  const mw = 220
  const mh = 140
  let left = m.x
  let top = m.y
  if (typeof window !== 'undefined') {
    if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad)
    if (top + mh > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - mh - pad)
  }
  return { left: `${left}px`, top: `${top}px` }
})

function bumpTreePointerTs() {
  lastTreePointerTs.value = Date.now()
}

function tryCloseDrawerFromChrome() {
  if (!narrow.value || !drawerOpen.value) return
  if (Date.now() - lastTreePointerTs.value < 450) return
  drawerOpen.value = false
}

const isLandscape = ref(window.innerWidth > window.innerHeight)
const narrow = ref(isNarrowViewport())
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)

const TREE_WIDTH_STORAGE = 'dinotty_tree_pane_width'

function loadTreePaneWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(TREE_WIDTH_STORAGE) || '', 10)
    if (Number.isFinite(v) && v >= 120 && v <= 720) return v
  } catch {}
  return 260
}

const treePaneWidth = ref(loadTreePaneWidth())

function persistTreePaneWidth() {
  try {
    localStorage.setItem(TREE_WIDTH_STORAGE, String(treePaneWidth.value))
  } catch {}
}

const treeWrapStyle = computed(() => {
  if (narrow.value) return {}
  return { width: `${treePaneWidth.value}px` }
})

function clampTreePaneWidth() {
  const body = fileWorkspaceBodyRef.value
  if (!body || narrow.value) return
  const maxW = Math.min(body.getBoundingClientRect().width * 0.78, 560)
  if (treePaneWidth.value > maxW) treePaneWidth.value = Math.max(120, maxW)
}

function startTreeWidthDrag(e: MouseEvent) {
  if (narrow.value) return
  const body = fileWorkspaceBodyRef.value
  if (!body) return
  const startX = e.clientX
  const startW = treePaneWidth.value
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
  document.body.appendChild(overlay)
  const onMove = (ev: MouseEvent) => {
    const rect = body.getBoundingClientRect()
    const maxW = Math.min(rect.width * 0.78, 560)
    const dx = ev.clientX - startX
    treePaneWidth.value = Math.max(120, Math.min(maxW, startW + dx))
  }
  const onUp = () => {
    overlay.remove()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    persistTreePaneWidth()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function startTreeWidthDragTouch(e: TouchEvent) {
  if (narrow.value) return
  const body = fileWorkspaceBodyRef.value
  if (!body) return
  const startX = e.touches[0].clientX
  const startW = treePaneWidth.value
  const onMove = (ev: TouchEvent) => {
    const touch = ev.touches[0]
    const rect = body.getBoundingClientRect()
    const maxW = Math.min(rect.width * 0.78, 560)
    const dx = touch.clientX - startX
    treePaneWidth.value = Math.max(120, Math.min(maxW, startW + dx))
  }
  const onEnd = () => {
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
    persistTreePaneWidth()
  }
  window.addEventListener('touchmove', onMove, { passive: true })
  window.addEventListener('touchend', onEnd)
}

const direction = computed(() => (isLandscape.value ? 'horizontal' : 'vertical'))

const cwdShort = computed(() => {
  const s = cwdLabel.value
  if (s.length <= 36) return s
  return '…' + s.slice(-34)
})

const rawUrl = computed(() => {
  if (!selectedRel.value || selectedIsDir.value) return ''
  const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
  const token = getAuthToken()
  if (token) q.set('token', token)
  return apiUrl(`/api/workspace/raw?${q}`)
})

const inlineCreateForTree = computed(() => inlineCreate.value ?? undefined)

const inlineInputPlaceholder = computed(() => {
  if (!inlineCreate.value) return ''
  return inlineCreate.value.kind === 'dir' ? t('filePreview.nameFolder') : t('filePreview.nameFile')
})

const editorDirty = computed(() => editorText.value !== editorBaseline.value)

const canSaveEditorContext = computed(
  () =>
    !!selectedRel.value &&
    !selectedIsDir.value &&
    !meta.value?.truncated &&
    (meta.value?.kind === 'text' || meta.value?.kind === 'markdown'),
)

const canSaveEditor = computed(
  () => canSaveEditorContext.value && editorDirty.value,
)

const markdownEditorHtml = computed(() => {
  const src = editorText.value
  if (!src) return ''
  try {
    const html = marked.parse(src, { async: false }) as string
    return DOMPurify.sanitize(html)
  } catch {
    return ''
  }
})

const canDownload = computed(
  () => !!selectedRel.value && !selectedIsDir.value && meta.value?.kind !== 'unsupported',
)

const canDelete = computed(() => !!selectedRel.value)

const MAX_HIGHLIGHT_SIZE = 100_000

const codeLines = computed(() => {
  const text = editorText.value || ''
  return text.split('\n')
})

const highlightedLines = computed(() => {
  const text = editorText.value || ''
  if (text.length > MAX_HIGHLIGHT_SIZE) {
    return esc(text).split('\n')
  }
  const language = meta.value?.language || 'plaintext'
  let html = ''
  try {
    if (language !== 'plaintext' && hljs.getLanguage(language)) {
      html = hljs.highlight(text, { language }).value
    } else if (language === 'plaintext') {
      html = esc(text)
    } else {
      html = hljs.highlightAuto(text).value
    }
  } catch {
    html = esc(text)
  }
  return html.split('\n')
})

const highlightedHtml = computed(() => {
  return highlightedLines.value.join('\n')
})

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function onEditorScroll(e: Event) {
  const textarea = e.target as HTMLTextAreaElement
  const lineNumbers = textarea.closest('.file-code-preview')?.querySelector('.file-code-line-numbers') as HTMLElement
  const highlighted = textarea.closest('.file-code-preview')?.querySelector('.file-code-highlighted') as HTMLElement
  if (lineNumbers) {
    lineNumbers.scrollTop = textarea.scrollTop
  }
  if (highlighted) {
    highlighted.scrollTop = textarea.scrollTop
    highlighted.scrollLeft = textarea.scrollLeft
  }
}

const watchSocket = ref<WebSocket | null>(null)
const isWatching = ref(false)

async function connectWatchSocket(path: string) {
  disconnectWatchSocket()

  const base = await getApiBase()
  const apiBase = base || window.location.origin
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsBase = apiBase.replace(/^https?:\/\//, `${wsProtocol}//`)
  const wsUrl = `${wsBase}/ws/watch?pane_id=${props.paneId}&path=${encodeURIComponent(path)}`

  try {
    const ws = new WebSocket(wsUrlWithToken(wsUrl))
    watchSocket.value = ws

    ws.onopen = () => {
      isWatching.value = true
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'file_event') {
          handleFileChange(data)
        }
      } catch {}
    }

    ws.onclose = () => {
      isWatching.value = false
      watchSocket.value = null
    }

    ws.onerror = () => {
      isWatching.value = false
      watchSocket.value = null
    }
  } catch {}
}

function disconnectWatchSocket() {
  if (watchSocket.value) {
    watchSocket.value.close()
    watchSocket.value = null
    isWatching.value = false
  }
}

function handleFileChange(event: { type: string; path: string }) {
  if (!selectedRel.value || selectedIsDir.value) return

  const changedPath = event.path.replace(/\\/g, '/')
  const currentFile = selectedRel.value

  const normalizedChanged = changedPath.endsWith('/') ? changedPath.slice(0, -1) : changedPath
  const normalizedCurrent = currentFile.endsWith('/') ? currentFile.slice(0, -1) : currentFile

  if (normalizedChanged.endsWith(normalizedCurrent) || normalizedChanged.includes(`/${normalizedCurrent}`)) {
    if (!editorDirty.value) {
      refreshCurrentFile()
    }
  }
}

// --- Tree watcher: watches the workspace root to detect file/dir create/delete ---
const treeWatchSocket = ref<WebSocket | null>(null)
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null

async function connectTreeWatchSocket() {
  disconnectTreeWatchSocket()

  const base = await getApiBase()
  const apiBase = base || window.location.origin
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsBase = apiBase.replace(/^https?:\/\//, `${wsProtocol}//`)
  const wsUrl = `${wsBase}/ws/watch?pane_id=${props.paneId}&path=${encodeURIComponent('/')}`

  try {
    const ws = new WebSocket(wsUrlWithToken(wsUrl))
    treeWatchSocket.value = ws

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'file_event') {
          handleTreeChange(data)
        }
      } catch {}
    }

    ws.onclose = () => { treeWatchSocket.value = null }
    ws.onerror = () => { treeWatchSocket.value = null }
  } catch {}
}

function disconnectTreeWatchSocket() {
  if (treeWatchSocket.value) {
    treeWatchSocket.value.close()
    treeWatchSocket.value = null
  }
  if (treeRefreshTimer) {
    clearTimeout(treeRefreshTimer)
    treeRefreshTimer = null
  }
}

function handleTreeChange(event: { type: string; path?: string }) {
  const changedPath = (event.path || '').replace(/\\/g, '/')
  if (!changedPath) return

  const parentDir = changedPath.substring(0, changedPath.lastIndexOf('/') + 1)

  if (treeRefreshTimer) clearTimeout(treeRefreshTimer)
  treeRefreshTimer = setTimeout(() => {
    treeRefreshTimer = null
    refreshTreeDir(parentDir)
  }, 300)
}

async function refreshTreeDir(absDir: string) {
  const cwd = (cwdLabel.value || '').replace(/\\/g, '/')
  const cwdNorm = cwd.endsWith('/') ? cwd : cwd + '/'

  let rel = ''
  if (absDir.startsWith(cwdNorm)) {
    rel = absDir.slice(cwdNorm.length)
  } else {
    rel = ''
  }
  if (rel.endsWith('/')) rel = rel.slice(0, -1)

  try {
    const entries = await fetchList(rel)
    childCache.value = { ...childCache.value, [rel]: entries }
  } catch {}
}

async function refreshCurrentFile() {
  if (!selectedRel.value || selectedIsDir.value) return

  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
    const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
    if (!res.ok) return
    const newMeta = await res.json()
    if (newMeta?.kind === 'text' || newMeta?.kind === 'markdown') {
      meta.value = newMeta
      editorText.value = newMeta.content ?? ''
      editorBaseline.value = newMeta.content ?? ''
    }
  } catch {}
}

watch(
  () => selectedRel.value,
  (newPath) => {
    if (newPath && !selectedIsDir.value) {
      connectWatchSocket(newPath)
    } else {
      disconnectWatchSocket()
    }
  },
)

onBeforeUnmount(() => {
  disconnectWatchSocket()
  disconnectTreeWatchSocket()
})

const previewContentRef1 = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const previewContentRef2 = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const audioRef = computed(() => previewContentRef1.value?.audioRef ?? previewContentRef2.value?.audioRef ?? null)
const audioPlaying = ref(false)
const audioCurrent = ref(0)
const audioDuration = ref(0)
const audioVolValue = ref(100)

const audioTitle = computed(() => (selectedRel.value ? selectedRel.value.split('/').pop() || selectedRel.value : ''))
const audioSub = computed(() => '')
const audioSeekValue = computed(() => {
  const d = audioDuration.value
  if (!d || !Number.isFinite(d)) return 0
  const v = (audioCurrent.value / d) * 1000
  return Math.max(0, Math.min(1000, Math.round(v)))
})

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '00:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const mm = String(m).padStart(2, '0')
  const sss = String(ss).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${sss}` : `${mm}:${sss}`
}

const audioTimeNow = computed(() => fmtTime(audioCurrent.value))
const audioTimeTotal = computed(() => fmtTime(audioDuration.value))

function syncAudioVol() {
  const el = audioRef.value
  if (!el) return
  el.volume = Math.max(0, Math.min(1, audioVolValue.value / 100))
}

function toggleAudio() {
  const el = audioRef.value
  if (!el) return
  syncAudioVol()
  if (el.paused) {
    void el.play().then(
      () => (audioPlaying.value = true),
      () => (audioPlaying.value = false),
    )
  } else {
    el.pause()
    audioPlaying.value = false
  }
}

function seekAudio(deltaSec: number) {
  const el = audioRef.value
  if (!el) return
  const d = Number.isFinite(el.duration) ? el.duration : audioDuration.value
  const next = Math.max(0, Math.min(d || Infinity, (Number.isFinite(el.currentTime) ? el.currentTime : 0) + deltaSec))
  el.currentTime = next
  audioCurrent.value = next
}

function onAudioSeekInput(ev: Event) {
  const el = audioRef.value
  if (!el) return
  const v = (ev.target as HTMLInputElement).valueAsNumber
  const d = Number.isFinite(el.duration) ? el.duration : audioDuration.value
  if (!d || !Number.isFinite(d)) return
  const next = (Math.max(0, Math.min(1000, v)) / 1000) * d
  el.currentTime = next
  audioCurrent.value = next
}

function onAudioVolumeInput(ev: Event) {
  audioVolValue.value = (ev.target as HTMLInputElement).valueAsNumber
  syncAudioVol()
}

function onAudioTimeUpdate() {
  const el = audioRef.value
  if (!el) return
  audioCurrent.value = Number.isFinite(el.currentTime) ? el.currentTime : 0
  audioDuration.value = Number.isFinite(el.duration) ? el.duration : audioDuration.value
  audioPlaying.value = !el.paused
}

function onAudioLoadedMetadata() {
  const el = audioRef.value
  if (!el) return
  audioDuration.value = Number.isFinite(el.duration) ? el.duration : 0
  audioCurrent.value = Number.isFinite(el.currentTime) ? el.currentTime : 0
  syncAudioVol()
}

function onAudioEnded() {
  audioPlaying.value = false
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || 'plaintext').trim() || 'plaintext'
      let inner: string
      try {
        if (language !== 'plaintext' && hljs.getLanguage(language)) {
          inner = hljs.highlight(text, { language }).value
        } else if (language === 'plaintext') {
          inner = esc(text)
        } else {
          inner = hljs.highlightAuto(text).value
        }
      } catch {
        inner = esc(text)
      }
      const safeLang = language.replace(/[^a-z0-9_-]/gi, '') || 'plaintext'
      return `<pre><code class="hljs language-${safeLang}">${inner}</code></pre>`
    },
  },
})

function close() {
  emit('close')
}

function onResize() {
  isLandscape.value = window.innerWidth > window.innerHeight
  const next = isNarrowViewport()
  const was = narrow.value
  narrow.value = next
  if (!next) drawerOpen.value = false
  else if (!was && next) drawerOpen.value = true
  requestAnimationFrame(() => clampTreePaneWidth())
}

watch(narrow, (isNarrow) => {
  if (isNarrow) treeCollapsed.value = false
})

watch(
  () => [selectedRel.value, selectedIsDir.value, meta.value?.kind, meta.value?.content, meta.value?.truncated],
  () => {
    if (selectedIsDir.value || !selectedRel.value) {
      editorText.value = ''
      editorBaseline.value = ''
      return
    }
    const m = meta.value
    if (m?.kind === 'text' || m?.kind === 'markdown') {
      const c = m.content ?? ''
      editorText.value = c
      editorBaseline.value = c
    } else {
      editorText.value = ''
      editorBaseline.value = ''
    }
  },
)

watch(
  () => [rawUrl.value, meta.value?.kind],
  () => {
    if (meta.value?.kind !== 'audio') return
    const el = audioRef.value
    if (!el) return
    el.pause()
    audioPlaying.value = false
    audioCurrent.value = 0
    audioDuration.value = 0
    syncAudioVol()
  },
)

watch(selectedRel, () => {
  mdShowPreview.value = false
})

function shouldBlockNavigate(): boolean {
  if (
    !editorDirty.value ||
    !meta.value ||
    (meta.value.kind !== 'text' && meta.value.kind !== 'markdown')
  ) {
    return false
  }
  return !confirm(t('filePreview.discardChanges'))
}

async function trySelectFile(rel: string) {
  if (shouldBlockNavigate()) return
  await onSelectFile(rel)
}

function trySelectDir(rel: string) {
  if (shouldBlockNavigate()) return
  onSelectDir(rel)
}

function parentRelPath(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

function newItemParentRel(): string {
  if (selectedIsDir.value && selectedRel.value) return selectedRel.value
  if (!selectedIsDir.value && selectedRel.value) return parentRelPath(selectedRel.value)
  return ''
}

function startNewFile() {
  if (shouldBlockNavigate()) return
  const parentRel = newItemParentRel()
  inlineCreate.value = { parentRel, kind: 'file' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

function startNewFolder() {
  if (shouldBlockNavigate()) return
  const parentRel = newItemParentRel()
  inlineCreate.value = { parentRel, kind: 'dir' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

async function onInlineCreateCommit(name: string) {
  if (!inlineCreate.value) return
  if (!name) {
    inlineCreate.value = null
    return
  }
  const { parentRel, kind } = inlineCreate.value
  inlineCreate.value = null
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, parent: parentRel })
  const res = await authFetch(apiUrl(`/api/workspace/create?${q}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, name }),
  })
  if (!res.ok) {
    previewErr.value = res.status === 409 ? 'exists' : 'create failed'
    return
  }
  previewErr.value = ''
  const data = await res.json()
  const rel = data.rel as string
  const next = { ...childCache.value }
  delete next[parentRel]
  childCache.value = next
  try {
    await ensureChildren(parentRel)
  } catch {}
  if (kind === 'file') await onSelectFile(rel)
  else {
    expanded.value = new Set([...expanded.value, rel])
    onSelectDir(rel)
    void ensureChildren(rel)
  }
}

function onInlineCreateCancel() {
  inlineCreate.value = null
}

async function saveEditor() {
  if (!canSaveEditor.value || !selectedRel.value) return
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
  const res = await authFetch(apiUrl(`/api/workspace/file?${q}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: editorText.value }),
  })
  if (!res.ok) return
  editorBaseline.value = editorText.value
  if (meta.value && (meta.value.kind === 'text' || meta.value.kind === 'markdown')) {
    meta.value = { ...meta.value, content: editorText.value, truncated: false, message: undefined }
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

function onTreeContextMenu(payload: { ev: MouseEvent; rel: string; isDir: boolean }) {
  payload.ev.preventDefault()
  contextMenu.value = {
    x: payload.ev.clientX,
    y: payload.ev.clientY,
    rel: payload.rel,
    isDir: payload.isDir,
  }
}

function onTreeBgContextMenu(ev: MouseEvent) {
  ev.preventDefault()
  contextMenu.value = {
    x: ev.clientX,
    y: ev.clientY,
    rel: '',
    isDir: true,
  }
}

function onTreeLongPress(pos: { clientX: number; clientY: number }, rel: string, isDir: boolean) {
  contextMenu.value = { x: pos.clientX, y: pos.clientY, rel, isDir }
}

function ctxNewFile() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  if (shouldBlockNavigate()) return
  const parentRel = isDir ? rel : parentRelPath(rel)
  inlineCreate.value = { parentRel, kind: 'file' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

function ctxNewFolder() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  if (shouldBlockNavigate()) return
  const parentRel = isDir ? rel : parentRelPath(rel)
  inlineCreate.value = { parentRel, kind: 'dir' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

function ctxRename() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  const targetRel = rel || selectedRel.value
  if (!targetRel) return
  const targetIsDir = rel ? isDir : selectedIsDir.value
  inlineRename.value = { rel: targetRel, isDir: targetIsDir }
}

async function onInlineRenameCommit(newName: string) {
  if (!inlineRename.value) return
  if (!newName) {
    inlineRename.value = null
    return
  }
  const { rel, isDir } = inlineRename.value
  inlineRename.value = null
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  const res = await authFetch(apiUrl(`/api/workspace/rename?${q}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: newName }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    previewErr.value = j.error || 'rename failed'
    return
  }
  previewErr.value = ''
  const data = await res.json()
  const newRel = data.rel as string
  const parentRel = parentRelPath(rel)
  const next = { ...childCache.value }
  delete next[parentRel]
  if (isDir) {
    for (const k of Object.keys(next)) {
      if (k === rel || k.startsWith(`${rel}/`)) delete next[k]
    }
  }
  childCache.value = next
  try {
    await ensureChildren(parentRel)
  } catch {}
  if (selectedRel.value === rel) {
    if (isDir) onSelectDir(newRel)
    else await onSelectFile(newRel)
  }
}

function onInlineRenameCancel() {
  inlineRename.value = null
}

async function onMoveEntry(payload: { src: string; destDir: string }) {
  const { src, destDir } = payload
  if (!src) return
  const srcParent = parentRelPath(src)
  if (srcParent === destDir) return

  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: src })
  const res = await authFetch(apiUrl(`/api/workspace/move?${q}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dest: destDir }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    previewErr.value = j.error || 'move failed'
    return
  }
  previewErr.value = ''

  const next = { ...childCache.value }
  delete next[srcParent]
  delete next[destDir]
  for (const k of Object.keys(next)) {
    if (k === src || k.startsWith(`${src}/`)) delete next[k]
  }
  childCache.value = next
  try {
    await Promise.all([ensureChildren(srcParent), ensureChildren(destDir)])
  } catch {}
}

async function ctxDelete() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  const targetRel = rel || selectedRel.value
  const targetIsDir = rel ? isDir : selectedIsDir.value
  if (!targetRel) return
  const discardNeeded =
    editorDirty.value && meta.value && (meta.value.kind === 'text' || meta.value.kind === 'markdown')
  const prevRel = selectedRel.value
  const prevIsDir = selectedIsDir.value
  const prevMeta = meta.value
  const deleteMsg = targetIsDir ? t('filePreview.confirmDeleteFolder') : t('filePreview.confirmDeleteFile')
  if (discardNeeded) {
    if (!confirm(`${t('filePreview.discardChanges')}\n\n${deleteMsg}`)) return
    editorText.value = editorBaseline.value
  }
  selectedRel.value = targetRel
  selectedIsDir.value = targetIsDir
  meta.value = null
  const ok = await deleteSelected(discardNeeded ?? false)
  if (!ok) {
    selectedRel.value = prevRel
    selectedIsDir.value = prevIsDir
    meta.value = prevMeta
  }
}

function onCloseContextScroll() {
  if (contextMenu.value) contextMenu.value = null
}

function onEditorSaveKeydown(e: KeyboardEvent) {
  if (contextMenu.value && e.key === 'Escape') {
    e.preventDefault()
    closeContextMenu()
    return
  }
  if (!props.visible) return
  const saveChord =
    (e.metaKey || e.ctrlKey) && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')
  if (!saveChord) return
  if (!canSaveEditorContext.value) return
  e.preventDefault()
  if (canSaveEditor.value) void saveEditor()
}

async function fetchList(rel: string): Promise<DirEntry[]> {
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  const res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
  if (!res.ok) throw new Error('list failed')
  const data = await res.json()
  cwdLabel.value = data.cwd || ''
  return data.entries || []
}

async function ensureChildren(rel: string) {
  const key = rel
  if (childCache.value[key]) return
  const entries = await fetchList(rel)
  childCache.value = { ...childCache.value, [key]: entries }
}

function onToggle(rel: string) {
  const next = new Set(expanded.value)
  if (next.has(rel)) next.delete(rel)
  else next.add(rel)
  expanded.value = next
  if (next.has(rel)) void ensureChildren(rel)
}

function absolutePath(rel: string): string {
  const root = cwdLabel.value.replace(/\/+$/, '')
  return rel ? `${root}/${rel}` : root
}

function onSelectDir(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = true
  meta.value = null
  previewErr.value = ''
  pushNav(rel, true)
  emit('navigate', absolutePath(rel))
}

async function onSelectFile(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = false
  previewErr.value = ''
  previewLoading.value = true
  meta.value = null
  officeLoading.value = false
  officeErr.value = ''
  officeHtml.value = ''
  pushNav(rel, false)
  emit('navigate', absolutePath(rel))
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
    const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      previewErr.value = j.error || 'error'
      return
    }
    meta.value = await res.json()
    if (meta.value?.kind === 'office') {
      void loadOfficePreview(rel)
    }
  } catch {
    previewErr.value = 'network'
  } finally {
    previewLoading.value = false
  }
}

function officeNodeToHtml(node: any): string {
  if (!node) return ''
  const type = String(node.type || '')
  if (type === 'table') {
    const rows = Array.isArray(node.children) ? node.children : []
    const tr = rows
      .map((r: any) => {
        const cells = Array.isArray(r.children) ? r.children : []
        const tds = cells
          .map((c: any) => `<td>${esc(String(c.text ?? ''))}</td>`)
          .join('')
        return `<tr>${tds}</tr>`
      })
      .join('')
    return `<table>${tr}</table>`
  }
  if (type === 'list') {
    const items = Array.isArray(node.children) ? node.children : []
    const li = items.map((it: any) => `<li>${officeNodeToHtml(it) || esc(String(it.text ?? ''))}</li>`).join('')
    return `<ul>${li}</ul>`
  }
  if (type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node?.metadata?.level || 2)))
    return `<h${level}>${esc(String(node.text ?? ''))}</h${level}>`
  }
  if (type === 'paragraph') {
    const txt = String(node.text ?? '').trim()
    if (!txt) return ''
    return `<p>${esc(txt)}</p>`
  }
  const children = Array.isArray(node.children) ? node.children.map(officeNodeToHtml).join('') : ''
  if (children) return children
  const txt = String(node.text ?? '').trim()
  return txt ? `<p>${esc(txt)}</p>` : ''
}

async function loadOfficePreview(rel: string) {
  officeLoading.value = true
  officeErr.value = ''
  officeHtml.value = ''
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
    const res = await authFetch(apiUrl(`/api/workspace/raw?${q}`))
    if (!res.ok) throw new Error('raw')
    const buf = await res.arrayBuffer()
    const ast: any = await (officeParser as any).parseOffice(buf)
    const nodes = Array.isArray(ast?.content) ? ast.content : []
    const html = nodes.map(officeNodeToHtml).join('') || `<pre>${esc(ast?.toText?.() || '')}</pre>`
    officeHtml.value = DOMPurify.sanitize(html)
  } catch {
    officeErr.value = 'unsupported'
  } finally {
    officeLoading.value = false
  }
}

async function reloadAll() {
  inlineCreate.value = null
  contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set([''])
  previewErr.value = ''
  meta.value = null
  try {
    await ensureChildren('')
  } catch {
    previewErr.value = 'list failed'
  }
}

watch(
  () => [props.visible, props.paneId, props.embedded],
  () => {
    if (props.visible && props.paneId && !props.embedded) void boot()
  },
  { immediate: true },
)

async function boot() {
  drawerOpen.value = false
  selectedRel.value = null
  selectedIsDir.value = false
  meta.value = null
  previewErr.value = ''
  inlineCreate.value = null
  contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set([''])
  try {
    await ensureChildren('')
    connectTreeWatchSocket()
  } catch {
    previewErr.value = 'list failed'
  }
}

function bumpPreviewLayout() {
  void nextTick().then(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
    })
  })
}

async function openFromTerminal(path: string) {
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path })
  const res = await authFetch(apiUrl(`/api/workspace/resolve?${q}`))
  if (!res.ok) return
  const { rel } = await res.json()
  previewErr.value = ''
  inlineCreate.value = null
  contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set([''])
  try {
    await ensureChildren('')
  } catch {
    previewErr.value = 'list failed'
    return
  }
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) {
    selectedRel.value = null
    selectedIsDir.value = false
    meta.value = null
    bumpPreviewLayout()
    return
  }
  let acc = ''
  const nextExpanded = new Set(expanded.value)
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    nextExpanded.add(acc)
    await ensureChildren(acc)
  }
  expanded.value = nextExpanded
  const base = parts[parts.length - 1]
  const parentRel = parts.slice(0, -1).join('/')
  await ensureChildren(parentRel)
  const full = rel
  const parentEntries = childCache.value[parentRel]
  const entry = parentEntries?.find((e) => e.name === base)
  if (entry?.is_dir) onSelectDir(full)
  else await onSelectFile(full)
  bumpPreviewLayout()
}

function triggerUpload() {
  fileInputRef.value?.click()
}

async function uploadFiles(files: { file: File; path: string }[]) {
  if (!files.length) return
  await getApiBase()
  const dir = selectedIsDir.value && selectedRel.value ? selectedRel.value : ''
  const q = new URLSearchParams({ pane_id: props.paneId, dir })
  const fd = new FormData()
  for (const { file, path } of files) {
    fd.append('path', path)
    fd.append('file', file)
  }
  try {
    const res = await authFetch(apiUrl(`/api/workspace/upload?${q}`), { method: 'POST', body: fd })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      console.error('[upload] server error:', res.status, text)
    }
  } catch (e) {
    console.error('[upload] request failed:', e)
  }
  await reloadAll()
}

async function onFilePick(ev: Event) {
  const inp = ev.target as HTMLInputElement
  const fileList = inp.files
  if (!fileList?.length) return
  const files: { file: File; path: string }[] = []
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i]
    files.push({ file: f, path: f.webkitRelativePath || f.name })
  }
  inp.value = ''
  try {
    await uploadFiles(files)
  } catch (e) {
    console.error('[upload] file pick upload failed:', e)
  }
}

async function traverseEntry(entry: FileSystemEntry, basePath: string): Promise<{ file: File; path: string }[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    try {
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject))
      return [{ file, path: basePath + entry.name }]
    } catch (e) {
      console.warn('[upload] skip unreadable file:', basePath + entry.name, e)
      return []
    }
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const entries: FileSystemEntry[] = []
    try {
      let batch: FileSystemEntry[]
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        entries.push(...batch)
      } while (batch.length > 0)
    } catch (e) {
      console.warn('[upload] skip unreadable directory:', basePath + entry.name, e)
      return []
    }
    const results: { file: File; path: string }[] = []
    const childResults = await Promise.all(entries.map(child => traverseEntry(child, basePath + entry.name + '/')))
    for (const r of childResults) results.push(...r)
    return results
  }
  return []
}

async function onDrop(ev: DragEvent) {
  const items = ev.dataTransfer?.items
  if (!items) return
  const allFiles: { file: File; path: string }[] = []
  const promises: Promise<void>[] = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) {
      promises.push(traverseEntry(entry, '').then(files => { allFiles.push(...files) }))
    }
  }
  try {
    await Promise.all(promises)
  } catch (e) {
    console.error('[upload] directory traversal failed:', e)
  }
  if (!allFiles.length) {
    console.warn('[upload] no files resolved from drop')
    return
  }
  await uploadFiles(allFiles)
}

async function downloadSelected() {
  if (!selectedRel.value || selectedIsDir.value) return
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
  const res = await authFetch(apiUrl(`/api/workspace/raw?${q}`))
  if (!res.ok) return
  const blob = await res.blob()
  const name = selectedRel.value.split('/').pop() || 'file'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

async function deleteSelected(skipConfirm = false): Promise<boolean> {
  const rel = selectedRel.value
  if (!rel) return false
  inlineCreate.value = null
  const wasDir = selectedIsDir.value
  const msg = wasDir ? t('filePreview.confirmDeleteFolder') : t('filePreview.confirmDeleteFile')
  if (!skipConfirm && !confirm(msg)) return false
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  const res = await authFetch(apiUrl(`/api/workspace/delete?${q}`), { method: 'DELETE' })
  if (!res.ok) return false
  const parentRel = parentRelPath(rel)
  if (wasDir) {
    const next: Record<string, DirEntry[]> = { ...childCache.value }
    for (const k of Object.keys(next)) {
      if (k === rel || k.startsWith(`${rel}/`)) delete next[k]
    }
    delete next[parentRel]
    childCache.value = next
    const nextExp = new Set(expanded.value)
    for (const k of [...nextExp]) {
      if (k === rel || k.startsWith(`${rel}/`)) nextExp.delete(k)
    }
    expanded.value = nextExp
  } else {
    const next = { ...childCache.value }
    delete next[parentRel]
    childCache.value = next
  }
  selectedRel.value = null
  selectedIsDir.value = false
  meta.value = null
  previewErr.value = ''
  officeLoading.value = false
  officeErr.value = ''
  officeHtml.value = ''
  emit('navigate', absolutePath(parentRel))
  try {
    await ensureChildren(parentRel)
  } catch {}
  return true
}

const { startDrag } = usePaneResize('.file-workspace', direction)

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onEditorSaveKeydown, true)
  window.addEventListener('scroll', onCloseContextScroll, true)
  void getApiBase()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onEditorSaveKeydown, true)
  window.removeEventListener('scroll', onCloseContextScroll, true)
})

function openDrawer() {
  if (!narrow.value) return
  drawerOpen.value = true
}

function toggleDrawer() {
  if (!narrow.value) return
  drawerOpen.value = !drawerOpen.value
}

defineExpose({
  openFromTerminal,
  reloadAll,
  triggerUpload,
  downloadSelected,
  deleteSelected,
  startNewFile,
  startNewFolder,
  saveEditor,
  openDrawer,
  toggleDrawer,
  drawerOpen,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
})
</script>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.file-workspace-embedded {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.file-workspace-body.embedded .file-workspace-tree-wrap.drawer {
  top: 0;
}

.file-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.file-workspace.horizontal {
  flex-direction: row;
  height: 100%;
}

.file-workspace.vertical {
  flex-direction: column;
  width: 100%;
}

.file-workspace-divider {
  flex-shrink: 0;
  background: var(--border, #333);
  z-index: 2;
}

.file-workspace.horizontal .file-workspace-divider {
  width: 6px;
  cursor: col-resize;
}

.file-workspace.vertical .file-workspace-divider {
  height: 6px;
  cursor: row-resize;
}

.file-workspace-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.file-workspace-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--tab-bg, #252525);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
}

.file-workspace-toolbar button {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}

.file-workspace-toolbar button:hover:not(:disabled) {
  color: var(--fg, #ccc);
  background: var(--tab-hover-bg, #333);
}

.file-workspace-toolbar button:disabled {
  opacity: 0.35;
  cursor: default;
}

.file-workspace-toolbar .file-workspace-delete-btn:not(:disabled) {
  color: var(--color-red, #c91b00);
}

.file-workspace-toolbar .file-workspace-delete-btn:not(:disabled):hover {
  color: var(--color-red, #ff453a);
}

.file-workspace-add-menu {
  position: relative;
}
.file-workspace-add-backdrop {
  position: fixed;
  inset: 0;
  z-index: 199;
}
.file-workspace-add-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 120px;
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 200;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
}
.file-workspace-add-dropdown button {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--fg, #C7C7C7);
  text-align: left;
  white-space: nowrap;
  border-radius: 0;
}
.file-workspace-add-dropdown button:hover {
  background: rgba(255,255,255,0.06);
}

.file-workspace-cwd {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-workspace-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.file-workspace-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.12);
  border: 2px dashed rgba(59, 130, 246, 0.5);
  border-radius: 6px;
  font-size: 14px;
  color: var(--fg, #C7C7C7);
  pointer-events: none;
}

.file-workspace-body.drawer-mode .file-workspace-preview {
  flex: 1 1 0;
  min-height: 0;
}

.file-workspace-tree-wrap {
  min-width: 120px;
  overflow: auto;
  flex-shrink: 0;
  background: var(--bg, #1a1a1a);
}

.file-workspace-tree-splitter {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: var(--border, #333);
  align-self: stretch;
  transition: background 0.12s;
}

.file-workspace-tree-splitter:hover {
  background: var(--accent, #89b4fa);
}

.file-workspace-tree-reveal {
  flex-shrink: 0;
  width: 22px;
  align-self: stretch;
  border: none;
  border-right: 1px solid var(--border, #333);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  line-height: 1;
}

.file-workspace-tree-reveal:hover {
  color: var(--accent, #89b4fa);
  background: var(--tab-hover-bg, #333);
}

.file-workspace-tree-wrap.drawer {
  position: absolute;
  left: 0;
  top: 72px;
  bottom: 0;
  z-index: 120;
  width: min(86vw, 320px);
  max-width: 100%;
  box-shadow: 4px 0 12px rgba(0, 0, 0, 0.4);
}

.file-workspace-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 110;
}

.file-workspace-body.drawer-mode {
  position: relative;
}

.file-explorer-actions {
  display: flex;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
  background: var(--tab-bg, #252525);
}

.file-explorer-icon-btn {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0.85;
}

.file-explorer-icon-btn:hover {
  background: var(--tab-hover-bg, #333);
  opacity: 1;
}

.file-editor-root {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-editor-chrome {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--tab-bg, #252525);
  flex-shrink: 0;
}

.file-editor-dirty {
  font-size: 12px;
  color: var(--color-orange, #d19a66);
}

.file-editor-tab {
  border: none;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.file-editor-tab:hover {
  color: var(--fg, #ccc);
}

.file-editor-save {
  margin-left: auto;
  border: none;
  background: var(--accent, #0e639c);
  color: #fff;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
}

.file-editor-save:disabled {
  opacity: 0.4;
  cursor: default;
}

.file-code-preview {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  position: relative;
}

.file-code-line-numbers {
  flex-shrink: 0;
  width: clamp(40px, 5vw, 60px);
  overflow: hidden;
  background: var(--bg, #1a1a1a);
  border-right: 1px solid var(--border, #333);
  user-select: none;
  margin: 0;
  padding: clamp(8px, 2vmin, 14px) clamp(6px, 1.5vmin, 12px) clamp(8px, 2vmin, 14px) 0;
  text-align: right;
  color: var(--fg-muted, #666);
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs, 13px);
  line-height: 1.45;
  white-space: pre;
}

.file-code-editor {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.file-code-highlighted {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: clamp(8px, 2vmin, 14px);
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs, 13px);
  line-height: 1.45;
  background: var(--bg-surface, #141414);
  color: var(--fg, #ccc);
  white-space: pre;
  overflow: auto;
  pointer-events: none;
  z-index: 1;
}

.file-code-highlighted code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
}

.file-editor-textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: none;
  resize: none;
  margin: 0;
  padding: clamp(8px, 2vmin, 14px);
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs, 13px);
  line-height: 1.45;
  background: transparent;
  color: transparent;
  caret-color: var(--fg, #ccc);
  outline: none;
  z-index: 2;
  overflow: auto;
}

.file-editor-textarea:disabled {
  opacity: 0.65;
}

.file-editor-textarea::selection {
  background: rgba(100, 150, 255, 0.3);
}

.file-code-highlighted :deep(.hljs-keyword) {
  color: var(--color-magenta, #ca30c7);
}
.file-code-highlighted :deep(.hljs-string) {
  color: var(--color-green, #00c200);
}
.file-code-highlighted :deep(.hljs-number) {
  color: var(--color-yellow, #c7c400);
}
.file-code-highlighted :deep(.hljs-comment) {
  color: var(--fg-muted, #666);
  font-style: italic;
}
.file-code-highlighted :deep(.hljs-title),
.file-code-highlighted :deep(.hljs-name) {
  color: var(--color-cyan, #56b6c2);
}
.file-code-highlighted :deep(.hljs-attr) {
  color: var(--color-orange, #d19a66);
}
.file-code-highlighted :deep(.hljs-built_in) {
  color: var(--accent, #89b4fa);
}

.file-editor-preview {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.file-workspace-tree :deep(.tree-inline-create) {
  align-items: center;
}

.file-workspace-tree :deep(.tree-inline-input) {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  padding: 2px 6px;
  border: 1px solid var(--accent, #89b4fa);
  border-radius: 2px;
  background: var(--bg-surface, #141414);
  color: var(--fg, #ccc);
  outline: none;
  font-family: var(--font-mono);
}

.file-workspace-tree {
  --tree-base-hpad: 8px;
  --tree-indent-step: 8px;
  --tree-icon-size: 16px;
  --tree-twistie-size: 16px;
  --tree-row-height: 22px;
  --tree-row-hover: var(--list-hover-bg, rgba(255, 255, 255, 0.06));
  --tree-row-selected: var(--list-selection-bg, #04395e);
  --tree-row-selected-fg: var(--list-selection-fg, #ffffff);
  padding: 2px 0;
  min-height: 100%;
  font-size: 13px;
  line-height: var(--tree-row-height);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
}

.file-workspace-tree :deep(.tree-rows) {
  user-select: none;
}

.file-workspace-tree :deep(.tree-row) {
  display: flex;
  flex-direction: row;
  align-items: center;
  box-sizing: border-box;
  height: var(--tree-row-height);
  min-height: var(--tree-row-height);
  padding: 0 8px 0 0;
  margin: 0;
  border-radius: 2px;
}

.file-workspace-tree :deep(.tree-row:hover) {
  background: var(--tree-row-hover);
}

.file-workspace-tree :deep(.tree-row.drop-target) {
  background: var(--tree-row-selected);
  outline: 1px solid var(--focus-border, #007fd4);
  outline-offset: -1px;
}

.file-workspace-tree :deep(.tree-row:has(.tree-label.sel)) {
  background: var(--tree-row-selected);
}

.file-workspace-tree :deep(.tree-row:has(.tree-label.sel):hover) {
  background: var(--tree-row-selected);
}

.file-workspace-tree :deep(.tree-twistie) {
  border: none;
  background: none;
  color: var(--fg-muted, #858585);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  width: var(--tree-twistie-size);
  min-width: var(--tree-twistie-size);
  height: var(--tree-row-height);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  opacity: 0.9;
}

.file-workspace-tree :deep(.tree-twistie:focus-visible) {
  outline: 1px solid var(--accent, #007fd4);
  outline-offset: -1px;
}

.file-workspace-tree :deep(.tree-twistie-placeholder) {
  flex-shrink: 0;
  width: var(--tree-twistie-size);
  min-width: var(--tree-twistie-size);
  height: var(--tree-row-height);
  display: inline-block;
  pointer-events: none;
}

.file-workspace-tree :deep(.tree-folder-hit) {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  min-width: 0;
  cursor: pointer;
}

.file-workspace-tree :deep(.tree-label) {
  cursor: pointer;
  color: var(--fg, #cccccc);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 0;
  font-weight: 400;
}

.file-workspace-tree :deep(.tree-label.sel) {
  color: var(--tree-row-selected-fg);
}

.file-workspace-tree :deep(.tree-row:has(.tree-label.sel) .tree-twistie) {
  color: rgba(255, 255, 255, 0.82);
}

.file-workspace-tree :deep(.tree-row:has(.tree-label.sel) .tree-kind-icon-folder) {
  color: var(--tree-folder-icon-selected, #e8dcc4);
}

.file-workspace-tree :deep(.tree-row:has(.tree-label.sel) .tree-kind-icon-file) {
  color: var(--tree-file-icon-selected, #b4e1ff);
}

.file-workspace-tree :deep(.tree-kind-icon) {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tree-icon-size);
  height: var(--tree-icon-size);
  margin-right: 6px;
}

.file-workspace-tree :deep(.tree-kind-icon-folder) {
  width: var(--tree-icon-size);
  height: var(--tree-icon-size);
  color: var(--tree-folder-icon, #dcb67a);
}

.file-workspace-tree :deep(.tree-kind-icon-file) {
  color: var(--tree-file-icon, #90caf9);
}

.file-workspace-tree :deep(.tree-svg) {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: block;
  flex-shrink: 0;
}

.file-workspace-preview {
  --preview-code-fs: 13px;
  --preview-prose-fs: clamp(12px, 2.55vmin, 17px);
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--bg-surface, #141414);
}

.file-workspace-placeholder {
  flex: 1 1 0;
  min-height: min(120px, 35vh);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #888);
  font-size: clamp(12px, 2.6vmin, 17px);
  padding: clamp(8px, 2vmin, 16px);
  text-align: center;
}

.file-workspace-placeholder.err {
  color: var(--color-red, #c91b00);
}

.file-workspace-preview > img.file-media,
.file-workspace-preview > video.file-media {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  align-self: stretch;
  object-fit: contain;
}

video.file-media {
  background: #000;
}

.file-audio-player {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: clamp(12px, 2.4vmin, 22px);
  box-sizing: border-box;
  color: var(--fg, #d6d6d6);
}

.file-audio-el {
  display: none;
}

.file-audio-head {
  display: flex;
  gap: 14px;
  align-items: center;
}

.file-audio-cover {
  width: clamp(64px, 9vmin, 92px);
  height: clamp(64px, 9vmin, 92px);
  border-radius: 14px;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(26px, 4.6vmin, 36px);
  color: rgba(255, 255, 255, 0.85);
  flex: 0 0 auto;
}

.file-audio-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-audio-title {
  font-size: clamp(15px, 3vmin, 20px);
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-bright, #ededed);
}

.file-audio-sub {
  font-size: clamp(12px, 2.3vmin, 14px);
  color: var(--fg-muted, #9a9a9a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-audio-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
}

.file-audio-time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--fg-muted, #9a9a9a);
}

.file-audio-seek {
  width: 100%;
  accent-color: rgba(255, 255, 255, 0.85);
}

.file-audio-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-audio-btn {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg, #d6d6d6);
  border-radius: 12px;
  padding: 8px 10px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}

.file-audio-btn.play {
  padding: 10px 14px;
  font-weight: 650;
}

.file-audio-spacer {
  flex: 1 1 0;
  min-width: 0;
}

.file-audio-vol-ico {
  color: var(--fg-muted, #9a9a9a);
  font-size: 12px;
}

.file-audio-vol {
  width: 140px;
  max-width: 30vw;
  accent-color: rgba(255, 255, 255, 0.85);
}

.file-office {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: clamp(10px, 2.2vmin, 18px);
  color: var(--fg, #ccc);
}

.file-office-body :deep(p) {
  margin: 0.55em 0;
  line-height: 1.55;
}

.file-office-body :deep(h1),
.file-office-body :deep(h2),
.file-office-body :deep(h3),
.file-office-body :deep(h4),
.file-office-body :deep(h5),
.file-office-body :deep(h6) {
  margin: 1.05em 0 0.45em;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg-bright, #e8e8e8);
}

.file-office-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  font-size: 0.92em;
}

.file-office-body :deep(td),
.file-office-body :deep(th) {
  border: 1px solid var(--border, #444);
  padding: 0.35em 0.55em;
  text-align: left;
  vertical-align: top;
}

.file-office-body :deep(th) {
  background: var(--tab-bg, #252525);
}

.file-pdf {
  flex: 1 1 0;
  min-height: min(240px, 45vh);
  width: 100%;
  border: none;
  background: #222;
}

.file-md {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: clamp(8px, 2vmin, 16px);
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs, 13px);
  color: var(--fg, #ccc);
  white-space: pre-wrap;
  word-break: break-word;
}

.file-md-body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: var(--preview-prose-fs, clamp(13px, 2.8vw, 16px));
  line-height: 1.55;
  white-space: normal;
  word-break: break-word;
}

.file-md-body :deep(h1),
.file-md-body :deep(h2),
.file-md-body :deep(h3),
.file-md-body :deep(h4) {
  margin: 1.1em 0 0.45em;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg-bright, #e8e8e8);
}

.file-md-body :deep(h1) {
  font-size: 1.45em;
  border-bottom: 1px solid var(--border, #333);
  padding-bottom: 0.25em;
}

.file-md-body :deep(h2) {
  font-size: 1.25em;
}

.file-md-body :deep(h3) {
  font-size: 1.08em;
}

.file-md-body :deep(p) {
  margin: 0.55em 0;
}

.file-md-body :deep(a) {
  color: var(--accent, #89b4fa);
  text-decoration: none;
}

.file-md-body :deep(a:hover) {
  text-decoration: underline;
}

.file-md-body :deep(ul),
.file-md-body :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.file-md-body :deep(li) {
  margin: 0.18em 0;
}

.file-md-body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0 0.2em 0.85em;
  border-left: 3px solid var(--border, #555);
  color: var(--fg-muted, #aaa);
}

.file-md-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border, #333);
  margin: 1em 0;
}

.file-md-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  font-size: 0.92em;
}

.file-md-body :deep(th),
.file-md-body :deep(td) {
  border: 1px solid var(--border, #444);
  padding: 0.35em 0.55em;
  text-align: left;
}

.file-md-body :deep(th) {
  background: var(--tab-bg, #252525);
}

.file-md-body :deep(pre) {
  margin: 0.65em 0;
  padding: 10px 12px;
  overflow: auto;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs);
  line-height: 1.45;
}

.file-md-body :deep(pre code) {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
}

.file-md-body :deep(code:not(pre code)) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 0.12em 0.38em;
  background: var(--tab-bg, #252525);
  border-radius: 3px;
}

.file-md-body :deep(img) {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.file-md-body :deep(input[type='checkbox']) {
  margin-right: 0.35em;
  vertical-align: middle;
}

.file-md-body :deep(.hljs-keyword) {
  color: var(--color-magenta, #ca30c7);
}
.file-md-body :deep(.hljs-string) {
  color: var(--color-green, #00c200);
}
.file-md-body :deep(.hljs-number) {
  color: var(--color-yellow, #c7c400);
}
.file-md-body :deep(.hljs-comment) {
  color: var(--fg-muted, #666);
  font-style: italic;
}
.file-md-body :deep(.hljs-title),
.file-md-body :deep(.hljs-name) {
  color: var(--color-cyan, #56b6c2);
}
.file-md-body :deep(.hljs-attr) {
  color: var(--color-orange, #d19a66);
}
.file-md-body :deep(.hljs-built_in) {
  color: var(--accent, #89b4fa);
}

.file-code-wrap {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: clamp(4px, 1vmin, 8px) 0;
}

.file-code-table {
  border-collapse: collapse;
  width: 100%;
}

.ln {
  padding: 0 clamp(6px, 1.5vmin, 12px);
  text-align: right;
  color: var(--fg-muted, #666);
  user-select: none;
  vertical-align: top;
  font-size: var(--preview-code-fs);
  border-right: 1px solid var(--border, #333);
}

.lc {
  padding: 0 clamp(8px, 1.8vmin, 14px);
  white-space: pre;
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs);
  color: var(--fg, #ccc);
}

.lc :deep(.hljs-keyword) {
  color: var(--color-magenta, #ca30c7);
}
.lc :deep(.hljs-string) {
  color: var(--color-green, #00c200);
}
.lc :deep(.hljs-number) {
  color: var(--color-yellow, #c7c400);
}
.lc :deep(.hljs-comment) {
  color: var(--fg-muted, #666);
  font-style: italic;
}
</style>

<style>
.tree-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: transparent;
}

.tree-ctx-menu {
  position: fixed;
  z-index: 100001;
  min-width: 216px;
  max-width: 320px;
  padding: 4px 0;
  margin: 0;
  border-radius: 6px;
  background: #252526;
  border: 1px solid #3c3c3c;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.tree-ctx-menu--bottom {
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  top: auto !important;
  min-width: 0;
  max-width: none;
  border-radius: 12px 12px 0 0;
  padding: 8px 0;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
}

.tree-ctx-menu--bottom .tree-ctx-item {
  padding: 12px 16px;
  font-size: 15px;
}

.tree-ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: #cccccc;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.tree-ctx-item:hover,
.tree-ctx-item:focus-visible {
  background: #094771;
  color: #ffffff;
  outline: none;
}

.tree-ctx-item-danger:hover,
.tree-ctx-item-danger:focus-visible {
  background: #5a1d1d;
  color: #ffcccc;
}

.tree-ctx-label {
  flex: 1;
  min-width: 0;
}

.tree-ctx-kbd {
  flex-shrink: 0;
  font-size: 11px;
  color: #888;
  font-variant-numeric: tabular-nums;
}

.tree-ctx-item:hover .tree-ctx-kbd,
.tree-ctx-item:focus-visible .tree-ctx-kbd {
  color: rgba(255, 255, 255, 0.75);
}

.tree-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: #3c3c3c;
  border: none;
  padding: 0;
}
</style>
