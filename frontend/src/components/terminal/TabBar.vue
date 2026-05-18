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
    <button id="tab-new-btn" title="New Tab (⌘T)" @click="$emit('new')" @touchend.prevent="$emit('new')"><Plus :size="16" /></button>
    <slot name="right"></slot>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { X, Plus } from 'lucide-vue-next'

export interface TabInfo {
  paneId: string
  title: string
}

withDefaults(defineProps<{
  tabs: TabInfo[]
  activePaneId: string | null
  indicators?: Record<string, string>
}>(), {
  indicators: () => ({})
})

const emit = defineEmits<{
  activate: [paneId: string]
  close: [paneId: string]
  new: []
  reorder: [fromId: string, toId: string]
}>()

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
  border-left: 2px solid var(--accent, #4d7fff);
}
.tab-notif-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: 4px;
}
.dot-info { background: var(--accent, #4d7fff); }
.dot-success { background: var(--color-green, #34d399); }
.dot-warning { background: var(--color-yellow, #f59e0b); }
.dot-error { background: var(--color-red, #ef4444); }
.dot-urgent { background: var(--color-red, #ef4444); animation: pulse-dot 1.5s infinite; }
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
