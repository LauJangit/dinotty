<template>
  <div id="app-root">
    <TabBar
      :tabs="tabList"
      :active-pane-id="activePaneId"
      @activate="activateTab"
      @close="closeTab"
      @new="newTab"
    >
      <template #right>
        <button type="button" class="tab-bar-icon-btn" :title="t('app.preview')" @click="openPreviewDirect">⊡</button>
        <button type="button" class="tab-bar-icon-btn" :title="t('app.settings')" @click="settingsOpen = true">⚙</button>
      </template>
    </TabBar>

    <div id="tab-content">
      <div
        v-for="tab in tabs"
        :key="tab.paneId"
        class="tab-page"
        :class="{ active: tab.paneId === activePaneId, 'has-preview': tab.previewVisible }"
      >
        <TerminalPane
          :ref="(el: any) => { if (el) termRefs[tab.paneId] = el }"
          :pane-id="tab.paneId"
          @title-change="(t: string) => onTitleChange(tab.paneId, t)"
          @file-click="(path: string) => filePreviewRef?.open(path)"
          @preview-link="(url: string) => onPreviewLink(tab.paneId, url)"
        />
        <WebPreview
          v-if="tab.paneId === activePaneId"
          :visible="tab.previewVisible"
          :url="tab.previewUrl"
          @close="closePreview(tab.paneId)"
        />
      </div>
    </div>

    <CommandPalette ref="paletteRef" :commands="paletteCommands" />

    <SettingsPanel :open="settingsOpen" @close="settingsOpen = false" />

    <FilePreview ref="filePreviewRef" />

    <CommandBookmarks ref="bookmarksRef" :get-send-fn="getSendFn" />

    <ServerList ref="serverListRef" @connect="onServerConnect" />

    <MobileKeyboard
      :visible="kbVisible"
      :get-send-fn="getSendFn"
      @update:visible="(v: boolean) => kbVisible = v"
    />

    <KbToggleButton
      v-show="!kbVisible"
      :visible="kbVisible"
      @toggle="kbVisible = !kbVisible"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import TabBar from './components/TabBar.vue'
import type { TabInfo } from './components/TabBar.vue'
import TerminalPane from './components/TerminalPane.vue'
import CommandPalette from './components/CommandPalette.vue'
import type { Command } from './components/CommandPalette.vue'
import MobileKeyboard from './components/MobileKeyboard.vue'
import KbToggleButton from './components/KbToggleButton.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import FilePreview from './components/FilePreview.vue'
import WebPreview from './components/WebPreview.vue'
import CommandBookmarks from './components/CommandBookmarks.vue'
import ServerList from './components/ServerList.vue'
import type { SyncServerMsg, SyncClientMsg } from './types/protocol'
import { useSettings } from './composables/useSettings'
import { useI18n } from './composables/useI18n'

interface Tab {
  paneId: string
  title: string
  previewVisible: boolean
  previewUrl: string
}

const tabs = ref<Tab[]>([])
const activePaneId = ref<string | null>(null)
const kbVisible = ref(false)
const settingsOpen = ref(false)
const paletteRef = ref<InstanceType<typeof CommandPalette>>()
const filePreviewRef = ref<InstanceType<typeof FilePreview>>()
const bookmarksRef = ref<InstanceType<typeof CommandBookmarks>>()
const serverListRef = ref<InstanceType<typeof ServerList>>()

const { settings: appSettings } = useSettings()
const { t } = useI18n()

watch(
  () => appSettings.locale,
  (l) => {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN'
  },
  { immediate: true },
)
const termRefs = reactive<Record<string, InstanceType<typeof TerminalPane>>>({})

let syncWs: WebSocket | null = null
let suppressSync = false

const tabList = computed<TabInfo[]>(() =>
  tabs.value.map((t) => ({ paneId: t.paneId, title: t.title }))
)

function genPaneId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function sendSync(msg: SyncClientMsg) {
  if (syncWs && syncWs.readyState === WebSocket.OPEN && !suppressSync) {
    syncWs.send(JSON.stringify(msg))
  }
}

function persist() {
  const state = tabs.value.map((t) => ({
    paneId: t.paneId,
    title: t.title,
  }))
  const activeIdx = tabs.value.findIndex((t) => t.paneId === activePaneId.value)
  localStorage.setItem('xterm_tabs', JSON.stringify({ tabs: state, activeIdx }))
}

function getSavedTitle(paneId: string): string | null {
  try {
    const raw = localStorage.getItem('xterm_tabs')
    if (!raw) return null
    const { tabs: savedTabs } = JSON.parse(raw)
    const t = savedTabs?.find((t: any) => t.paneId === paneId)
    return t?.title ?? null
  } catch { return null }
}

function newTab() {
  const paneId = genPaneId()
  tabs.value.push({ paneId, title: 'Terminal', previewVisible: false, previewUrl: '' })
  activePaneId.value = paneId
  sendSync({ type: 'create_tab', pane_id: paneId })
  persist()
  nextTick(() => focusActive())
}

function activateTab(paneId: string) {
  activePaneId.value = paneId
  sendSync({ type: 'activate_tab', pane_id: paneId })
  persist()
  nextTick(() => focusActive())
}

function closeTab(paneId: string) {
  if (tabs.value.length === 1) {
    const oldTab = tabs.value[0]
    sendSync({ type: 'close_tab', pane_id: oldTab.paneId })
    // Replace with new tab
    const newPaneId = genPaneId()
    // Remove old terminal ref
    delete termRefs[oldTab.paneId]
    oldTab.paneId = newPaneId
    oldTab.title = 'Terminal'
    oldTab.previewVisible = false
    oldTab.previewUrl = ''
    activePaneId.value = newPaneId
    sendSync({ type: 'create_tab', pane_id: newPaneId })
    persist()
    return
  }

  const idx = tabs.value.findIndex((t) => t.paneId === paneId)
  if (idx === -1) return

  delete termRefs[paneId]
  tabs.value.splice(idx, 1)

  if (activePaneId.value === paneId) {
    const newIdx = Math.min(idx, tabs.value.length - 1)
    activePaneId.value = tabs.value[newIdx].paneId
  }

  sendSync({ type: 'close_tab', pane_id: paneId })
  persist()
  nextTick(() => focusActive())
}

function focusActive() {
  if (activePaneId.value && termRefs[activePaneId.value]) {
    termRefs[activePaneId.value].focus()
    termRefs[activePaneId.value].fit()
  }
}

function onTitleChange(paneId: string, title: string) {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (tab) {
    tab.title = title || 'Terminal'
    persist()
  }
}

function onPreviewLink(paneId: string, url: string) {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (!tab) return
  tab.previewUrl = url
  tab.previewVisible = true
}

function closePreview(paneId: string) {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (tab) tab.previewVisible = false
}

const DEFAULT_PREVIEW_URL = 'http://localhost:5173/'

function openPreviewDirect() {
  const pid = activePaneId.value
  if (!pid) return
  const tab = tabs.value.find((t) => t.paneId === pid)
  if (!tab) return
  if (!tab.previewUrl) tab.previewUrl = DEFAULT_PREVIEW_URL
  tab.previewVisible = true
}

function getSendFn(): ((data: string) => void) | null {
  if (!activePaneId.value || !termRefs[activePaneId.value]) return null
  return (data: string) => termRefs[activePaneId.value!]?.sendData(data)
}

function onServerConnect(host: string, port: number) {
  // Navigate to the new server
  const proto = location.protocol
  window.location.href = `${proto}//${host}:${port}/`
}

// Palette commands
const paletteCommands = computed<Command[]>(() => [
  {
    icon: '＋', title: 'New Tab',
    subtitle: 'Open a new terminal tab',
    kbd: ['⌘', 'T'],
    action: () => newTab(),
  },
  {
    icon: '✕', title: 'Close Tab',
    subtitle: 'Close the current tab',
    kbd: ['⌘', 'W'],
    action: () => { if (activePaneId.value) closeTab(activePaneId.value) },
  },
  {
    icon: '★', title: 'Saved Commands',
    subtitle: 'Open bookmarked commands',
    action: () => bookmarksRef.value?.open(),
  },
  {
    icon: '⊡', title: 'Open Preview',
    subtitle: 'Preview a localhost port',
    action: () => openPreviewDirect(),
  },
])

// Global keyboard shortcuts
function onGlobalKeydown(e: KeyboardEvent) {
  const cmd = e.metaKey || e.ctrlKey
  const shift = e.shiftKey
  if (!cmd) return

  if (e.key === 'k' && !shift) { e.preventDefault(); paletteRef.value?.toggle(); return }
  if (e.key === 't' && !shift) { e.preventDefault(); newTab(); return }
  if (e.key === 'w' && !shift) { e.preventDefault(); if (activePaneId.value) closeTab(activePaneId.value); return }

  if (!shift && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1
    if (idx < tabs.value.length) {
      e.preventDefault()
      activateTab(tabs.value[idx].paneId)
    }
  }
}

// Sync WebSocket
function connectSyncWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}/ws/sync`
  syncWs = new WebSocket(url)

  syncWs.onmessage = (e) => {
    let msg: SyncServerMsg
    try { msg = JSON.parse(e.data) } catch { return }

    if (msg.type === 'tab_list') {
      const localPaneIds = new Set(tabs.value.map((t) => t.paneId))

      for (const tab of msg.tabs) {
        if (!localPaneIds.has(tab.pane_id)) {
          const saved = getSavedTitle(tab.pane_id)
          tabs.value.push({
            paneId: tab.pane_id,
            title: saved || 'Terminal',
            previewVisible: false,
            previewUrl: '',
          })
        }
      }

      // Remove local tabs not on server
      const serverIds = new Set(msg.tabs.map((t) => t.pane_id))
      tabs.value = tabs.value.filter((t) => serverIds.has(t.paneId))

      if (msg.active_pane_id) {
        activePaneId.value = msg.active_pane_id
      }

      if (msg.tabs.length === 0 && tabs.value.length === 0) {
        newTab()
      }

      persist()
    } else if (msg.type === 'tab_created') {
      if (!tabs.value.some((t) => t.paneId === msg.pane_id)) {
        tabs.value.push({
          paneId: msg.pane_id,
          title: 'Terminal',
          previewVisible: false,
          previewUrl: '',
        })
      }
    } else if (msg.type === 'tab_closed') {
      const idx = tabs.value.findIndex((t) => t.paneId === msg.pane_id)
      if (idx !== -1 && tabs.value.length > 1) {
        delete termRefs[msg.pane_id]
        tabs.value.splice(idx, 1)
        if (activePaneId.value === msg.pane_id) {
          activePaneId.value = tabs.value[Math.min(idx, tabs.value.length - 1)].paneId
        }
        persist()
      }
    } else if (msg.type === 'tab_activated') {
      if (activePaneId.value !== msg.pane_id) {
        suppressSync = true
        activePaneId.value = msg.pane_id
        suppressSync = false
      }
    }
  }

  syncWs.onclose = () => {
    syncWs = null
    setTimeout(connectSyncWS, 2000)
  }

  syncWs.onerror = () => {}
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
  connectSyncWS()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  if (syncWs) { syncWs.close(); syncWs = null }
})
</script>

<style>
#app-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100% - var(--mkb-height, 0px));
}
.tab-page.active.has-preview {
  display: flex;
}
@media (orientation: landscape) {
  .tab-page.active.has-preview {
    flex-direction: row;
  }
}
@media (orientation: portrait) {
  .tab-page.active.has-preview {
    flex-direction: column;
  }
}
.tab-page.active.has-preview > .terminal-pane-container {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
