<template>
  <div class="terminal-pane-container" @contextmenu.prevent>
    <div ref="wrapperRef" class="terminal-pane"></div>
  </div>
  <ConfirmModal
    :visible="confirmVisible"
    :title="confirmTitle"
    :message="confirmMessage"
    :target="confirmTarget"
    :confirm-text="confirmBtnText"
    :cancel-text="t('terminal.cancel')"
    @confirm="onConfirm"
    @cancel="confirmVisible = false"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../../composables/useTerminal'
import { useI18n } from '../../composables/useI18n'
import ConfirmModal from '../ui/ConfirmModal.vue'

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
  linkActivate: []
  input: [data: string]
}>()

const { t } = useI18n()
const wrapperRef = ref<HTMLElement>()
let terminal: TerminalInstance | null = null

const confirmVisible = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
const confirmTarget = ref('')
const confirmBtnText = ref('')
let confirmType: 'file' | 'link' = 'file'
let pendingPath = ''
let pendingUrl = ''

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

function setOutputListener(cb: ((data: string) => void) | null) {
  if (terminal) terminal.onRawOutput = cb
}

function onConfirm() {
  confirmVisible.value = false
  if (confirmType === 'file') {
    emit('fileClick', pendingPath)
  } else {
    emit('previewLink', pendingUrl)
  }
}

onMounted(() => {
  terminal = new TerminalInstance(props.paneId)
  terminal.onTitleChange = (tv) => emit('titleChange', tv)
  terminal.onShellInfo = (s) => emit('shellInfo', s)
  terminal.onConnect = () => emit('connect')
  terminal.onDisconnect = () => emit('disconnect')
  terminal.onInput = (data) => emit('input', data)
  terminal.onFileClick = (path) => {
    emit('linkActivate')
    confirmType = 'file'
    pendingPath = path
    confirmTitle.value = t('terminal.confirmOpenFileTitle')
    confirmMessage.value = t('terminal.confirmOpenFileMessage')
    confirmTarget.value = path
    confirmBtnText.value = t('terminal.confirmOpenFile')
    confirmVisible.value = true
  }
  terminal.onPreviewLink = (url) => {
    emit('linkActivate')
    confirmType = 'link'
    pendingUrl = url
    confirmTitle.value = t('terminal.confirmVisitUrlTitle')
    confirmMessage.value = t('terminal.confirmVisitUrlMessage')
    confirmTarget.value = url
    confirmBtnText.value = t('terminal.confirmVisitUrl')
    confirmVisible.value = true
  }

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

defineExpose({ getTerminal, focus, fit, sendData, setOutputListener })
</script>

<style scoped>
.terminal-pane-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
}
.terminal-pane {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
