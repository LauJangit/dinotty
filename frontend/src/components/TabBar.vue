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
        <button class="tab-close" @click.stop="$emit('close', tab.paneId)" @touchend.stop.prevent="$emit('close', tab.paneId)">✕</button>
      </div>
    </div>
    <button id="tab-new-btn" title="New Tab (⌘T)" @click="$emit('new')" @touchend.prevent="$emit('new')">+</button>
    <slot name="right"></slot>
  </div>
</template>

<script setup lang="ts">
export interface TabInfo {
  paneId: string
  title: string
}

defineProps<{
  tabs: TabInfo[]
  activePaneId: string | null
}>()

defineEmits<{
  activate: [paneId: string]
  close: [paneId: string]
  new: []
}>()
</script>
