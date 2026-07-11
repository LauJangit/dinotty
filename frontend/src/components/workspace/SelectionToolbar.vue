<template>
  <Teleport to="body">
    <div
      v-if="anchorRect"
      ref="toolbarRef"
      class="selection-toolbar"
      :style="toolbarStyle"
      @mousedown.stop
      @mouseup.stop
    >
      <button type="button" class="selection-toolbar-btn" @click="onCopy">
        {{ t('filePreview.copyText') }}
      </button>
      <button
        type="button"
        class="selection-toolbar-btn selection-toolbar-btn-accent"
        @click="onInsertToTerminal"
      >
        {{ t('filePreview.insertToTerminal') }}
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { copyToClipboard } from '../../utils/clipboard'

const props = defineProps<{
  selectedText: string
  anchorRect: DOMRect | null
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const { t } = useI18n()
const toolbarRef = ref<HTMLElement | null>(null)

const toolbarStyle = computed(() => {
  if (!props.anchorRect) return { display: 'none' }
  const margin = 8
  const toolbarWidth = 160
  let x = props.anchorRect.left + props.anchorRect.width / 2
  if (x - toolbarWidth / 2 < margin) x = margin + toolbarWidth / 2
  if (x + toolbarWidth / 2 > window.innerWidth - margin)
    x = window.innerWidth - margin - toolbarWidth / 2
  const bottom = window.innerHeight - props.anchorRect.top + 4
  return {
    left: `${x}px`,
    bottom: `${bottom}px`,
    transform: 'translateX(-50%)',
  }
})

function onCopy() {
  if (props.selectedText) copyToClipboard(props.selectedText)
  emit('dismiss')
}

function onInsertToTerminal() {
  if (props.selectedText) {
    window.dispatchEvent(
      new CustomEvent('terminal-insert-text', {
        detail: { text: props.selectedText },
      })
    )
  }
  emit('dismiss')
}

function onDocMouseDown(e: MouseEvent) {
  if (toolbarRef.value && toolbarRef.value.contains(e.target as Node)) return
  emit('dismiss')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('dismiss')
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('mousedown', onDocMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<style scoped>
.selection-toolbar {
  position: fixed;
  z-index: 9999;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  font-size: 12px;
  animation: selection-toolbar-in 0.12s ease-out;
}

@keyframes selection-toolbar-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.selection-toolbar-btn {
  border: none;
  background: transparent;
  color: var(--fg, #cccccc);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.selection-toolbar-btn:hover {
  background: var(--bg-hover);
}

.selection-toolbar-btn-accent {
  color: var(--accent, #89b4fa);
}

.selection-toolbar-btn-accent:hover {
  background: rgba(137, 180, 250, 0.15);
}
</style>
