import { ref, computed, type Ref, type ComputedRef } from 'vue'

// Global selected path state (shared across components)
const selectedPath = ref<string | null>(null)

export function useSelectedPath() {
  return { selectedPath }
}

export interface FileNavigation {
  navHistory: Ref<{ rel: string; isDir: boolean }[]>
  navIndex: Ref<number>
  canGoBack: ComputedRef<boolean>
  canGoForward: ComputedRef<boolean>
  pushNav: (rel: string, isDir: boolean) => void
  goBack: () => { rel: string; isDir: boolean } | null
  goForward: () => { rel: string; isDir: boolean } | null
}

export function useFileNavigation(): FileNavigation {
  const navHistory = ref<{ rel: string; isDir: boolean }[]>([])
  const navIndex = ref(-1)
  let navFromHistory = false

  const canGoBack = computed(() => navIndex.value > 0)
  const canGoForward = computed(() => navIndex.value < navHistory.value.length - 1)

  function pushNav(rel: string, isDir: boolean) {
    if (navFromHistory) {
      navFromHistory = false
      return
    }
    const cur = navHistory.value[navIndex.value]
    if (cur && cur.rel === rel && cur.isDir === isDir) return
    navHistory.value = navHistory.value.slice(0, navIndex.value + 1)
    navHistory.value.push({ rel, isDir })
    navIndex.value = navHistory.value.length - 1
  }

  function goBack(): { rel: string; isDir: boolean } | null {
    if (!canGoBack.value) return null
    navFromHistory = true
    navIndex.value--
    return navHistory.value[navIndex.value]
  }

  function goForward(): { rel: string; isDir: boolean } | null {
    if (!canGoForward.value) return null
    navFromHistory = true
    navIndex.value++
    return navHistory.value[navIndex.value]
  }

  return { navHistory, navIndex, canGoBack, canGoForward, pushNav, goBack, goForward }
}
