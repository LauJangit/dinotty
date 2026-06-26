<template>
  <AnimatePresence>
    <Motion
      v-if="visible"
      key="backdrop"
      ref="backdropRef"
      class="mc-backdrop"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.2 }"
      tabindex="0"
      @click.self="$emit('close')"
      @keydown="onKeydown"
    >
      <!-- Touch mode: simple button list -->
      <Motion
        v-if="isTouch"
        key="touch-list"
        class="mc-touch-list"
        :initial="{ y: 40, opacity: 0 }"
        :animate="{ y: 0, opacity: 1 }"
        :exit="{ y: 40, opacity: 0 }"
        :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
      >
        <button
          v-for="(card, i) in cards"
          :key="card.paneId"
          class="mc-touch-btn"
          :class="{ active: card.paneId === activePaneId }"
          @click="$emit('activate', card.paneId)"
        >
          <span class="mc-touch-btn-index">{{ card.index }}</span>
          <span class="mc-touch-btn-title">{{ card.title }}</span>
          <span
            v-if="card.type === 'plugin'"
            class="mc-touch-btn-tag"
          >Plugin</span>
          <span
            class="mc-touch-btn-close"
            @click.stop="$emit('close-tab', card.paneId)"
          >
            <X :size="16" />
          </span>
        </button>
      </Motion>

      <!-- Desktop mode: card grid with previews -->
      <Motion
        v-else
        key="card-grid"
        class="mc-grid"
        :style="gridStyle"
        :initial="{ scale: 0.9, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1 }"
        :exit="{ scale: 0.9, opacity: 0 }"
        :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
      >
        <Motion
          v-for="(card, i) in cards"
          :key="card.paneId"
          :ref="(el: any) => setCardRef(i, el)"
          class="mc-card"
          :class="{ active: card.paneId === activePaneId, focused: i === focusedIndex }"
          :initial="{ opacity: 0, y: 20 }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="{ opacity: 0, y: -10 }"
          :transition="{ delay: Math.min(i, 8) * 0.03, type: 'spring', damping: 20 }"
          @click="$emit('activate', card.paneId)"
          @mouseenter="focusedIndex = i"
        >
          <div class="mc-card-header">
            <span class="mc-card-index">{{ card.index }}</span>
            <span class="mc-card-title">{{ card.title }}</span>
            <button
              class="mc-card-close"
              :aria-label="`Close ${card.title}`"
              @click.stop="$emit('close-tab', card.paneId)"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="mc-card-preview">
            <img v-if="card.previewImage" :src="card.previewImage" />
            <SplitPreviewNode v-else-if="isSplitPreview(card.htmlContent)" :node="card.htmlContent" />
            <pre v-else-if="card.htmlContent" class="mc-card-text" v-html="card.htmlContent"></pre>
            <pre v-else-if="card.textContent" class="mc-card-text">{{ card.textContent }}</pre>
            <div v-else-if="card.type === 'plugin'" class="mc-plugin-placeholder">
              <Puzzle :size="32" />
              <span class="mc-plugin-label">{{ card.title }}</span>
            </div>
            <pre v-else class="mc-card-text"></pre>
          </div>
        </Motion>
      </Motion>
    </Motion>
  </AnimatePresence>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Motion, AnimatePresence } from 'motion-v'
import { X, Puzzle } from 'lucide-vue-next'
import type { TabCard, PanePreviewNode } from '../../composables/useTabPreview'
import { isTouchDevice } from '../../composables/useTerminal'
import SplitPreviewNode from './SplitPreviewNode.vue'

function isSplitPreview(content: string | PanePreviewNode): content is PanePreviewNode {
  return typeof content === 'object' && content !== null && 'direction' in content
}

const isTouch = isTouchDevice()

const props = defineProps<{
  visible: boolean
  cards: TabCard[]
  activePaneId: string | null
}>()

const emit = defineEmits<{
  close: []
  activate: [paneId: string]
  'close-tab': [paneId: string]
}>()

const COLS_SM = 2
const COLS_MD = 3
const COLS_LG = 4

const focusedIndex = ref(0)
const cardRefs = ref<(HTMLElement | null)[]>([])
const backdropRef = ref<any>(null)

function setCardRef(index: number, el: any) {
  cardRefs.value[index] = el?.$el ?? el ?? null
}

function getCols(): number {
  const w = window.innerWidth
  if (w >= 900) return COLS_LG
  if (w >= 480) return COLS_MD
  return COLS_SM
}

const gridStyle = computed(() => {
  const n = props.cards.length || 1
  return {
    '--mc-rows': Math.ceil(n / COLS_SM),
    '--mc-rows-md': Math.ceil(n / COLS_MD),
    '--mc-rows-lg': Math.ceil(n / COLS_LG),
  }
})

// Reset focused index when overlay opens
watch(
  () => props.visible,
  (v) => {
    if (v) {
      const idx = props.cards.findIndex((c) => c.paneId === props.activePaneId)
      focusedIndex.value = idx >= 0 ? idx : 0
      nextTick(() => backdropRef.value?.$el?.focus?.())
    }
  },
)

// Clamp focused index when cards change (e.g. tab closed)
watch(
  () => props.cards.length,
  (len) => {
    if (len && focusedIndex.value >= len) focusedIndex.value = len - 1
  },
)

function onKeydown(e: KeyboardEvent) {
  const len = props.cards.length
  if (!len) return

  const cols = getCols()
  const rows = Math.ceil(len / cols)
  const cur = focusedIndex.value
  const col = Math.floor(cur / rows)
  const row = cur % rows

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      focusedIndex.value = row > 0 ? cur - 1 : cur + rows - 1
      break
    case 'ArrowDown':
      e.preventDefault()
      focusedIndex.value = row < rows - 1 && cur + 1 < len ? cur + 1 : col * rows
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (col > 0) {
        const target = cur - rows
        focusedIndex.value = target >= 0 ? target : 0
      }
      break
    case 'ArrowRight':
      e.preventDefault()
      if (col < cols - 1) {
        const target = cur + rows
        focusedIndex.value = target < len ? target : len - 1
      }
      break
    case 'Enter':
      e.preventDefault()
      emit('activate', props.cards[cur].paneId)
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
    default:
      return
  }

  nextTick(() => {
    const el = cardRefs.value[focusedIndex.value]
    el?.scrollIntoView({ block: 'nearest' })
  })
}
</script>
