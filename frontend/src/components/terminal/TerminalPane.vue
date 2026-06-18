<template>
  <div
    class="terminal-pane-container"
    @contextmenu.prevent="onContextMenu"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <div ref="wrapperRef" class="terminal-pane"></div>
    <SearchBar v-if="searchVisible && terminal" :terminal="terminal" @close="searchVisible = false" />
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
  <TerminalContextMenu
    :visible="menuVisible"
    :x="menuX"
    :y="menuY"
    :selected-text="menuSelectedText"
    @close="closeMenu"
    @copy="onMenuCopy"
    @paste="onMenuPaste"
    @select-all="onMenuSelectAll"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../../composables/useTerminal'
import { useI18n } from '../../composables/useI18n'
import ConfirmModal from '../ui/ConfirmModal.vue'
import SearchBar from './SearchBar.vue'
import TerminalContextMenu from './TerminalContextMenu.vue'

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
const searchVisible = ref(false)

// Context menu state
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuSelectedText = ref('')

// Long-press state (mobile)
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressStartX = 0
let longPressStartY = 0
let longPressFired = false

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

function toggleSearch() {
  searchVisible.value = !searchVisible.value
}

function onContextMenu(e: MouseEvent) {
  if (!terminal) return
  if (terminal.isMouseModeEnabled()) return
  const text = terminal.getSelection()
  menuSelectedText.value = text
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
}

function closeMenu() {
  menuVisible.value = false
}

function onMenuCopy() {
  // copy already handled in TerminalContextMenu
}

async function onMenuPaste(text: string) {
  terminal?.pasteText(text)
}

function onMenuSelectAll() {
  terminal?.selectAll()
}

// Mobile long-press to open context menu
function onTouchStart(e: TouchEvent) {
  if (!terminal || terminal.isMouseModeEnabled()) return
  longPressFired = false
  const touch = e.touches[0]
  longPressStartX = touch.clientX
  longPressStartY = touch.clientY
  longPressTimer = setTimeout(() => {
    longPressFired = true
    const text = terminal!.getSelection()
    menuSelectedText.value = text
    menuX.value = longPressStartX
    menuY.value = longPressStartY
    menuVisible.value = true
  }, 500)
}

function onTouchMove(e: TouchEvent) {
  if (longPressTimer && !longPressFired) {
    const touch = e.touches[0]
    if (Math.abs(touch.clientX - longPressStartX) > 10 || Math.abs(touch.clientY - longPressStartY) > 10) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (longPressFired) {
    e.preventDefault()
    e.stopPropagation()
    longPressFired = false
  }
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressFired = false
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

defineExpose({ getTerminal, focus, fit, sendData, setOutputListener, toggleSearch })
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
