<template>
  <!-- Leaf node: render TerminalPane wrapper -->
  <div
    v-if="leaf"
    :class="['split-leaf', { active: leaf.paneId === activePaneId, zoomed: leaf.zoomed, 'broadcast-active': broadcastActive, 'broadcast-receiving': broadcastReceiving }]"
    :data-pane-id="leaf.paneId"
    @mousedown="onLeafClick(leaf.paneId)"
  >
    <PaneHeader
      v-if="showHeader"
      :pane-id="leaf.paneId"
      :title="leaf.title || 'Terminal'"
      :is-active="leaf.paneId === activePaneId"
      :direction="parentDirection"
      @reorder="(src, tgt, pos) => emit('reorder', src, tgt, pos)"
    />
    <button
      v-if="allowClose"
      class="pane-close-btn"
      :title="t('split.closePane')"
      @mousedown.stop
      @click.stop="emit('close', leaf!.paneId)"
    >&times;</button>
    <template v-if="broadcastActive">
      <div class="broadcast-line" />
      <div class="broadcast-badge">{{ t('split.broadcastActive') }}</div>
    </template>
    <div v-else-if="broadcastReceiving" class="broadcast-line receiving" />
    <TerminalPane
      :ref="(el: any) => emit('register', leaf!.paneId, el)"
      :pane-id="leaf.paneId"
      @title-change="(title: string) => emit('titleChange', leaf!.paneId, title)"
      @input="(data: string) => emit('input', leaf!.paneId, data)"
      @file-click="(path: string) => emit('fileClick', path)"
      @preview-link="(url: string) => emit('previewLink', leaf!.paneId, url)"
      @link-activate="emit('linkActivate')"
    />
  </div>

  <!-- Split node: render flex container with children and dividers -->
  <div
    v-else-if="split"
    ref="containerRef"
    :class="['split-container', split.direction]"
  >
    <template v-for="(child, idx) in split.children" :key="child.type === 'leaf' ? child.paneId : idx">
      <SplitContainer
        :layout="child"
        :active-pane-id="activePaneId"
        :broadcast-mode="broadcastMode"
        :broadcast-activity="broadcastActivity"
        :show-header="true"
        :allow-close="true"
        :parent-direction="split!.direction"
        :style="getChildStyle(idx)"
        @register="(id: string, el: any) => emit('register', id, el)"
        @title-change="(id: string, title: string) => emit('titleChange', id, title)"
        @focus="(id: string) => emit('focus', id)"
        @close="(id: string) => emit('close', id)"
        @input="(id: string, data: string) => emit('input', id, data)"
        @file-click="(path: string) => emit('fileClick', path)"
        @preview-link="(id: string, url: string) => emit('previewLink', id, url)"
        @link-activate="emit('linkActivate')"
        @reorder="(src: string, tgt: string, pos: DropPosition) => emit('reorder', src, tgt, pos)"
        @divider-drag-end="emit('dividerDragEnd')"
      />
      <SplitDivider
        v-if="idx < split.children.length - 1"
        :direction="split.direction"
        :left-ratio-ref="makeRatioRef(idx)"
        :right-ratio-ref="makeRatioRef(idx + 1)"
        :container-el="containerRef!"
        @drag-end="emit('dividerDragEnd')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PaneLayout, LeafPane, DropPosition } from '../../types/pane'
import TerminalPane from '../terminal/TerminalPane.vue'
import SplitDivider from './SplitDivider.vue'
import PaneHeader from './PaneHeader.vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  layout: PaneLayout
  activePaneId: string
  broadcastMode: boolean
  broadcastActivity: number
  showHeader?: boolean
  allowClose?: boolean
  parentDirection?: 'horizontal' | 'vertical'
}>()

const emit = defineEmits<{
  register: [paneId: string, el: any]
  titleChange: [paneId: string, title: string]
  focus: [paneId: string]
  close: [paneId: string]
  input: [paneId: string, data: string]
  fileClick: [path: string]
  previewLink: [paneId: string, url: string]
  linkActivate: []
  reorder: [sourcePaneId: string, targetPaneId: string, position: DropPosition]
  dividerDragEnd: []
}>()

const { t } = useI18n()
const containerRef = ref<HTMLElement>()

const leaf = computed(() => props.layout.type === 'leaf' ? props.layout as LeafPane : null)
const split = computed(() => props.layout.type === 'split' ? props.layout : null)

const broadcastActive = computed(() => {
  if (!leaf.value) return false
  return props.broadcastMode && leaf.value.paneId === props.activePaneId
})

const broadcastReceiving = computed(() => {
  if (!leaf.value) return false
  return props.broadcastMode && leaf.value.paneId !== props.activePaneId
})

function onLeafClick(paneId: string) {
  emit('focus', paneId)
}

function makeRatioRef(idx: number) {
  return computed({
    get: () => split.value?.ratios[idx] ?? 0,
    set: (val: number) => {
      if (split.value) {
        split.value.ratios[idx] = val
      }
    },
  })
}

function getChildStyle(idx: number) {
  if (!split.value) return {}
  const ratio = split.value.ratios[idx] ?? 1 / (split.value.children.length || 1)
  const dir = split.value.direction
  return {
    flex: `${ratio} 1 0%`,
    minWidth: dir === 'horizontal' ? '80px' : undefined,
    minHeight: dir === 'vertical' ? '40px' : undefined,
  }
}
</script>

<style scoped>
.split-container {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.split-container.horizontal {
  flex-direction: row;
}

.split-container.vertical {
  flex-direction: column;
}

.split-leaf {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  opacity: 0.55;
  transition: opacity 0.15s;
}

.split-leaf.active {
  opacity: 1;
}

.split-leaf.zoomed {
  position: absolute;
  inset: 0;
  z-index: 10;
  min-width: 0;
  min-height: 0;
}

.split-leaf.broadcast-active {
  outline: 2px solid var(--accent-color, #4d80ff);
  outline-offset: -1px;
}

.split-leaf.broadcast-receiving {
  outline: 2px solid rgba(77, 128, 255, 0.35);
  outline-offset: -1px;
}

/* Close button — visible on hover, positioned inside header when present */
.pane-close-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 20;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary, #888);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

/* Adjust close button position when vertical header with expanded padding is present */
.split-leaf:has(.direction-vertical) .pane-close-btn {
  top: 11px;
}

.split-leaf:hover .pane-close-btn {
  opacity: 1;
}

.pane-close-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Broadcast indicator — iTerm2 style */
.broadcast-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-color, #4d80ff);
  z-index: 10;
  pointer-events: none;
}

.broadcast-line.receiving {
  background: rgba(77, 128, 255, 0.35);
}

.broadcast-badge {
  position: absolute;
  top: 4px;
  right: 28px;
  z-index: 10;
  padding: 1px 8px;
  border-radius: 3px;
  background: rgba(77, 128, 255, 0.15);
  color: var(--accent-color, #4d80ff);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
  pointer-events: none;
}
</style>
