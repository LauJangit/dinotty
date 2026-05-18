<template>
  <div class="terminal-pane-container" @contextmenu.prevent>
    <div ref="wrapperRef" class="terminal-pane"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../../composables/useTerminal'

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
let terminal: TerminalInstance | null = null

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
