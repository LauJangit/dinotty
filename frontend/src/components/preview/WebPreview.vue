<template>
  <div v-if="visible" class="web-preview" :class="direction">
    <div
      class="web-preview-divider"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDragTouch"
    ></div>
    <div class="web-preview-panel">
      <div class="web-preview-toolbar">
        <button type="button" @click="refresh" title="Refresh">↻</button>
        <form class="web-preview-address" @submit.prevent="navigateFromInput">
          <input
            ref="addressInput"
            v-model="addressValue"
            type="text"
            enterkeyhint="go"
            inputmode="url"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            placeholder="URL or :port/path"
          />
          <button type="submit" class="go-btn" title="Go">→</button>
        </form>
        <button type="button" @click="close" title="Close">✕</button>
      </div>
      <div class="web-preview-content">
        <iframe
          ref="iframeRef"
          :src="resolvedSrc"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  visible: boolean
  url: string
}>()

const emit = defineEmits<{
  close: []
}>()

const iframeRef = ref<HTMLIFrameElement>()
const addressInput = ref<HTMLInputElement>()
const addressValue = ref('')
const currentUrl = ref('')
const navCounter = ref(0)
const isLandscape = ref(window.innerWidth > window.innerHeight)

function urlToSrc(url: string): string {
  if (!url) return 'about:blank'
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      const port = parsed.port || '80'
      return `/preview/${port}${parsed.pathname}${parsed.search}`
    }
  } catch {}
  return url
}

const resolvedSrc = computed(() => {
  if (!currentUrl.value) return 'about:blank'
  const base = urlToSrc(currentUrl.value)
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}_t=${navCounter.value}`
})

const direction = computed(() => {
  return isLandscape.value ? 'horizontal' : 'vertical'
})

function onResize() {
  isLandscape.value = window.innerWidth > window.innerHeight
}

watch(
  () => [props.url, props.visible],
  () => {
    if (props.visible && props.url) {
      currentUrl.value = props.url
      addressValue.value = props.url
      navCounter.value++
    }
  },
  { immediate: true }
)

function navigateFromInput() {
  const val = addressValue.value.trim()
  if (!val) return

  if (val.startsWith('http://') || val.startsWith('https://')) {
    currentUrl.value = val
  } else if (val.match(/^:?(\d+)(\/.*)?$/)) {
    const m = val.match(/^:?(\d+)(\/.*)?$/)!
    currentUrl.value = `http://localhost:${m[1]}${m[2] || '/'}`
    addressValue.value = currentUrl.value
  } else if (val.startsWith('/')) {
    try {
      const prev = new URL(currentUrl.value)
      prev.pathname = val
      currentUrl.value = prev.toString()
      addressValue.value = currentUrl.value
    } catch {
      return
    }
  } else {
    currentUrl.value = `http://${val}`
    addressValue.value = currentUrl.value
  }
  navCounter.value++
  addressInput.value?.blur()
}

function refresh() {
  navCounter.value++
}

function close() {
  emit('close')
}

function startDrag(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest('.web-preview') as HTMLElement
  const parent = el?.parentElement
  if (!parent) return

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
  document.body.appendChild(overlay)

  const onMove = (ev: MouseEvent) => {
    const rect = parent.getBoundingClientRect()
    const horiz = direction.value === 'horizontal'
    const total = horiz ? rect.width : rect.height
    const mousePos = horiz ? ev.clientX - rect.left : ev.clientY - rect.top
    const termPct = Math.max(15, Math.min(85, (mousePos / total) * 100))
    const termChild = parent.querySelector(':scope > .terminal-pane-container') as HTMLElement
    const previewChild = parent.querySelector(':scope > .web-preview') as HTMLElement
    if (termChild) termChild.style.flex = `0 0 ${termPct}%`
    if (previewChild) previewChild.style.flex = `0 0 ${100 - termPct}%`
  }
  const onUp = () => {
    overlay.remove()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    window.dispatchEvent(new Event('resize'))
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function startDragTouch(e: TouchEvent) {
  const el = (e.target as HTMLElement).closest('.web-preview') as HTMLElement
  const parent = el?.parentElement
  if (!parent) return

  const onMove = (ev: TouchEvent) => {
    const rect = parent.getBoundingClientRect()
    const touch = ev.touches[0]
    const horiz = direction.value === 'horizontal'
    const total = horiz ? rect.width : rect.height
    const touchPos = horiz ? touch.clientX - rect.left : touch.clientY - rect.top
    const termPct = Math.max(15, Math.min(85, (touchPos / total) * 100))
    const termChild = parent.querySelector(':scope > .terminal-pane-container') as HTMLElement
    const previewChild = parent.querySelector(':scope > .web-preview') as HTMLElement
    if (termChild) termChild.style.flex = `0 0 ${termPct}%`
    if (previewChild) previewChild.style.flex = `0 0 ${100 - termPct}%`
  }
  const onEnd = () => {
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
    window.dispatchEvent(new Event('resize'))
  }
  window.addEventListener('touchmove', onMove)
  window.addEventListener('touchend', onEnd)
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.web-preview {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.web-preview.horizontal {
  flex-direction: row;
  height: 100%;
}

.web-preview.vertical {
  flex-direction: column;
  width: 100%;
}

.web-preview-divider {
  flex-shrink: 0;
  background: var(--border);
  transition: background 0.15s;
  z-index: 2;
}

.web-preview.horizontal .web-preview-divider {
  width: 6px;
  cursor: col-resize;
}

.web-preview.vertical .web-preview-divider {
  height: 6px;
  cursor: row-resize;
}

.web-preview-divider:hover {
  background: var(--accent, #89b4fa);
}

.web-preview-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.web-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--tab-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.web-preview-toolbar button {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}

.web-preview-toolbar button:hover {
  color: var(--fg);
  background: var(--tab-hover-bg, #333);
}

.web-preview-address {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.web-preview-address:focus-within {
  border-color: var(--accent, #89b4fa);
}

.web-preview-address input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 8px;
  outline: none;
}

.go-btn {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 14px;
  padding: 2px 6px;
  cursor: pointer;
}

.go-btn:hover {
  color: var(--fg);
}

.web-preview-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #fff;
  min-height: 0;
}

.web-preview-content iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}
</style>
