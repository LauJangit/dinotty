<template>
  <div class="terminal-pane-container" @contextmenu.prevent="activateSelection">
    <div ref="wrapperRef" class="terminal-pane"></div>
    <SelectionOverlay ref="selectionRef" :get-terminal="getTerminal" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../composables/useTerminal'
import SelectionOverlay from './SelectionOverlay.vue'

const props = defineProps<{
  paneId: string
}>()

const emit = defineEmits<{
  titleChange: [title: string]
  shellInfo: [shell: string]
  connect: []
  disconnect: []
  fileClick: [path: string]
  previewLink: [url: string]
}>()

const wrapperRef = ref<HTMLElement>()
const selectionRef = ref<InstanceType<typeof SelectionOverlay>>()
let terminal: TerminalInstance | null = null
let longPressTimer: ReturnType<typeof setTimeout> | null = null

function getTerminal() {
  return terminal
}

function focus() {
  terminal?.focus()
}

function fit() {
  terminal?.fit()
}

function sendData(data: string) {
  terminal?.sendData(data)
}

function activateSelection() {
  selectionRef.value?.activate()
}

onMounted(() => {
  terminal = new TerminalInstance(props.paneId)
  terminal.onTitleChange = (t) => emit('titleChange', t)
  terminal.onShellInfo = (s) => emit('shellInfo', s)
  terminal.onConnect = () => emit('connect')
  terminal.onDisconnect = () => emit('disconnect')
  terminal.onFileClick = (path) => emit('fileClick', path)
  terminal.onPreviewLink = (url) => emit('previewLink', url)

  requestAnimationFrame(() => {
    if (wrapperRef.value) {
      terminal!.attach(wrapperRef.value)

      // Long-press detection for mobile selection mode
      const container = wrapperRef.value.parentElement!
      container.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          activateSelection()
        }, 600)
      }, { passive: true })
      container.addEventListener('touchmove', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
      }, { passive: true })
      container.addEventListener('touchend', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
      }, { passive: true })
    }
  })
})

onBeforeUnmount(() => {
  terminal?.destroy()
  terminal = null
})

defineExpose({ getTerminal, focus, fit, sendData })
</script>

<style scoped>
.terminal-pane-container {
  width: 100%;
  height: 100%;
  position: relative;
}
.terminal-pane {
  width: 100%;
  height: 100%;
}
</style>
