<template>
  <div id="tab-bar">
    <div id="tabs-list">
      <div
        v-for="tab in tabs"
        :key="tab.paneId"
        class="tab"
        :class="{ active: tab.paneId === activePaneId }"
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

defineEmits<{
  activate: [paneId: string]
  close: [paneId: string]
  new: []
}>()
</script>

<style scoped>
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
