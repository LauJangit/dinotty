<template>
  <div id="tab-bar">
    <div id="tabs-list">
      <div
        v-for="tab in tabs"
        :key="tab.paneId"
        class="tab"
        :class="{ active: tab.paneId === activePaneId, 'drag-over': dragOverId === tab.paneId }"
        draggable="true"
        @dragstart="onDragStart($event, tab.paneId)"
        @dragover.prevent="onDragOver(tab.paneId)"
        @dragleave="onDragLeave(tab.paneId)"
        @drop.prevent="onDrop(tab.paneId)"
        @dragend="onDragEnd"
        @click="$emit('activate', tab.paneId)"
        @touchend.prevent="$emit('activate', tab.paneId)"
      >
        <span class="tab-title">{{ tab.title }}</span>
        <span v-if="indicators[tab.paneId]" class="tab-notif-dot" :class="'dot-' + indicators[tab.paneId]"></span>
        <button class="tab-close" @click.stop="$emit('close', tab.paneId)" @touchend.stop.prevent="$emit('close', tab.paneId)"><X :size="10" /></button>
      </div>
    </div>
    <slot name="left" />
    <div class="new-tab-split" ref="newMenuWrapRef">
      <button id="tab-new-btn" title="New Tab (⌘T)" @click="newMenuOpen = !newMenuOpen" @touchend.prevent="newMenuOpen = !newMenuOpen"><Terminal :size="16" /></button>
      <div v-if="newMenuOpen" class="new-menu-dropdown" @mouseleave="newMenuOpen = false">
        <div class="new-menu-item" @click="emitAction('new-tab')" @touchend.prevent="emitAction('new-tab')">
          <Terminal :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('keybinding.newTab') }}</span>
          <kbd class="new-menu-kbd">{{ kbdNewTab }}</kbd>
        </div>
        <div class="new-menu-sep" />
        <div class="new-menu-item" @click="emitAction('split-h')" @touchend.prevent="emitAction('split-h')">
          <Columns2 :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('keybinding.splitHorizontal') }}</span>
          <kbd class="new-menu-kbd">{{ kbdSplitH }}</kbd>
        </div>
        <div class="new-menu-item" @click="emitAction('split-v')" @touchend.prevent="emitAction('split-v')">
          <Rows2 :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('keybinding.splitVertical') }}</span>
          <kbd class="new-menu-kbd">{{ kbdSplitV }}</kbd>
        </div>
        <template v-if="canBroadcast">
          <div class="new-menu-sep" />
          <div class="new-menu-item" @click="emitAction('broadcast')" @touchend.prevent="emitAction('broadcast')">
            <Radio :size="14" class="new-menu-icon" />
            <span class="new-menu-label">{{ t('split.toggleBroadcast') }}</span>
            <kbd class="new-menu-kbd">{{ kbdBroadcast }}</kbd>
          </div>
          <div v-if="broadcastActive" class="new-menu-status">{{ t('split.broadcastActive') }}</div>
        </template>
      </div>
    </div>
    <div v-if="plugins.length > 0" class="tab-bar-plugin-wrap" ref="pluginWrapRef">
      <button type="button" class="tab-bar-icon-btn" title="Plugins" @click="pluginMenuOpen = !pluginMenuOpen" @touchend.prevent="pluginMenuOpen = !pluginMenuOpen"><Blocks :size="16" /></button>
      <div v-if="pluginMenuOpen" class="plugin-dropdown" @mouseleave="pluginMenuOpen = false">
        <div
          v-for="p in plugins"
          :key="p.id"
          class="plugin-dropdown-item"
          @click="$emit('open-plugin', p.id); pluginMenuOpen = false"
          @touchend.prevent="$emit('open-plugin', p.id); pluginMenuOpen = false"
        >
          <span class="plugin-dropdown-name">{{ p.name }}</span>
          <span v-if="p.description" class="plugin-dropdown-desc">{{ p.description }}</span>
        </div>
      </div>
    </div>
    <slot name="right"></slot>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { X, Terminal, Blocks, Columns2, Rows2, Radio } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'

const { t } = useI18n()
const { getBinding, formatBinding } = useKeybindings()
const kbdNewTab = formatBinding(getBinding('newTab')).join('')
const kbdSplitH = formatBinding(getBinding('splitHorizontal')).join('')
const kbdSplitV = formatBinding(getBinding('splitVertical')).join('')
const kbdBroadcast = formatBinding(getBinding('toggleBroadcast')).join('')

export interface TabInfo {
  paneId: string
  title: string
}

export interface PluginInfo {
  id: string
  name: string
  description?: string
  icon?: string
  state: string
}

withDefaults(defineProps<{
  tabs: TabInfo[]
  activePaneId: string | null
  indicators?: Record<string, string>
  plugins?: PluginInfo[]
  canBroadcast?: boolean
  broadcastActive?: boolean
}>(), {
  indicators: () => ({}),
  plugins: () => ([]),
  canBroadcast: false,
  broadcastActive: false,
})

const emit = defineEmits<{
  activate: [paneId: string]
  close: [paneId: string]
  action: [type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast']
  reorder: [fromId: string, toId: string]
  'open-plugin': [pluginId: string]
}>()

const pluginMenuOpen = ref(false)
const pluginWrapRef = ref<HTMLElement>()
const newMenuOpen = ref(false)
const newMenuWrapRef = ref<HTMLElement>()

function emitAction(type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast') {
  emit('action', type)
  newMenuOpen.value = false
}

function onDocTouchStart(e: TouchEvent) {
  if (pluginWrapRef.value && !pluginWrapRef.value.contains(e.target as Node)) {
    pluginMenuOpen.value = false
  }
  if (newMenuWrapRef.value && !newMenuWrapRef.value.contains(e.target as Node)) {
    newMenuOpen.value = false
  }
}

watch([pluginMenuOpen, newMenuOpen], ([pluginOpen, newOpen]) => {
  if (pluginOpen || newOpen) {
    document.addEventListener('touchstart', onDocTouchStart, { passive: true })
  } else {
    document.removeEventListener('touchstart', onDocTouchStart)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('touchstart', onDocTouchStart)
})

const dragFromId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)

function onDragStart(e: DragEvent, paneId: string) {
  dragFromId.value = paneId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(paneId: string) {
  if (dragFromId.value && dragFromId.value !== paneId) {
    dragOverId.value = paneId
  }
}

function onDragLeave(paneId: string) {
  if (dragOverId.value === paneId) {
    dragOverId.value = null
  }
}

function onDrop(paneId: string) {
  if (dragFromId.value && dragFromId.value !== paneId) {
    emit('reorder', dragFromId.value, paneId)
  }
  dragFromId.value = null
  dragOverId.value = null
}

function onDragEnd() {
  dragFromId.value = null
  dragOverId.value = null
}
</script>

<style scoped>
.tab[draggable="true"] {
  cursor: grab;
}
.tab.drag-over {
  border-left: 2px solid var(--accent, #8A8A8A);
}
.tab-notif-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: 4px;
}
.dot-info { background: var(--accent, #8A8A8A); }
.dot-success { background: var(--color-green, #34d399); }
.dot-warning { background: var(--color-yellow, #f59e0b); }
.dot-error { background: var(--color-red, #ef4444); }
.dot-urgent { background: var(--color-red, #ef4444); animation: pulse-dot 1.5s infinite; }
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.tab-bar-plugin-wrap {
  position: relative;
}
.plugin-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 160px;
  background: var(--bg-surface, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 4px 0;
  z-index: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.plugin-dropdown-item {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plugin-dropdown-item:hover {
  background: var(--bg-hover, #2a2a2a);
}
.plugin-dropdown-name {
  white-space: nowrap;
}
.plugin-dropdown-desc {
  font-size: 11px;
  color: var(--text-muted, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.new-tab-split {
  position: relative;
}
.new-menu-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 220px;
  background: var(--bg-surface, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 4px 0;
  z-index: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.new-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.new-menu-item:hover {
  background: var(--bg-hover, #2a2a2a);
}
.new-menu-icon {
  flex-shrink: 0;
  color: var(--text-muted, #888);
}
.new-menu-label {
  flex: 1;
}
.new-menu-kbd {
  font-size: 11px;
  color: var(--text-muted, #888);
  font-family: inherit;
  background: var(--bg-hover, #2a2a2a);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border, #444);
}
.new-menu-sep {
  height: 1px;
  background: var(--border, #333);
  margin: 4px 0;
}
.new-menu-status {
  font-size: 11px;
  color: var(--accent, #8A8A8A);
  padding: 2px 12px 6px;
}
</style>
