import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { Tab } from '../types/pane'
import { getAllLeaves } from '../types/pane'

export interface ViewportResizeOptions {
  kbVisible: Ref<boolean>
  activePaneId: Ref<string | null>
  tabs: Ref<Tab[]>
  termRefs: Record<string, { fit: () => void }>
}

export interface ViewportResizeState {
  isLandscape: Ref<boolean>
  onViewportResize: () => void
  onOrientationChange: () => void
  dispose: () => void
}

export function useViewportResize(opts: ViewportResizeOptions): ViewportResizeState {
  const { kbVisible, activePaneId, tabs, termRefs } = opts

  const isLandscape = ref(window.innerWidth > window.innerHeight)
  let viewportRefitTimer = 0
  let naturalVH = 0

  function onViewportResize() {
    if (!window.visualViewport) return
    const vh = window.visualViewport.height
    if (vh > naturalVH) naturalVH = vh
    const off = window.innerHeight - (window.visualViewport.offsetTop + vh)
    document.documentElement.style.setProperty('--sys-kb-height', `${Math.max(0, off)}px`)
    const sysKbOpen = naturalVH > 0 && naturalVH - vh > 120
    document.documentElement.style.setProperty('--kb-open', (sysKbOpen || kbVisible.value) ? '1' : '0')

    clearTimeout(viewportRefitTimer)
    viewportRefitTimer = window.setTimeout(() => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (!tab || tab.type !== 'terminal') return
      for (const leaf of getAllLeaves(tab.layout)) {
        termRefs[leaf.paneId]?.fit()
      }
    }, 100)
  }

  function onOrientationChange() {
    isLandscape.value = window.innerWidth > window.innerHeight
  }

  watch(kbVisible, (v) => {
    document.documentElement.style.setProperty('--kb-open', v ? '1' : '0')
  })

  onMounted(() => {
    window.addEventListener('resize', onOrientationChange)
    if (window.visualViewport) {
      naturalVH = window.visualViewport.height
      window.visualViewport.addEventListener('resize', onViewportResize)
    }
  })

  function dispose() {
    clearTimeout(viewportRefitTimer)
    window.removeEventListener('resize', onOrientationChange)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onViewportResize)
    }
    document.documentElement.style.removeProperty('--sys-kb-height')
    document.documentElement.style.setProperty('--kb-open', '0')
  }

  onBeforeUnmount(dispose)

  return { isLandscape, onViewportResize, onOrientationChange, dispose }
}
