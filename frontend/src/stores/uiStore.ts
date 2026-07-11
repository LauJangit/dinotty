import { defineStore } from 'pinia'
import { ref } from 'vue'
import { hasAuthToken } from '../composables/apiBase'

export const useUiStore = defineStore('ui', () => {
  // ── State ──────────────────────────────────────────────

  /** Whether the sync WebSocket is connected */
  const syncConnected = ref(false)

  /** Mobile virtual keyboard visibility */
  const kbVisible = ref(false)

  /** Settings panel open state */
  const settingsOpen = ref(false)

  /** Whether the user is authenticated */
  const authenticated = ref(hasAuthToken())

  /** Whether initial server setup is required */
  const needsSetup = ref(false)

  /** Tab ID pending close confirmation */
  const pendingCloseTabId = ref<string | null>(null)

  /** Pane ID pending close confirmation (null = tab-level close) */
  const pendingClosePaneId = ref<string | null>(null)

  /** Whether the close confirmation modal is visible */
  const confirmCloseVisible = ref(false)

  // ── Actions ────────────────────────────────────────────

  /** Open the close confirmation for a tab (no specific pane) */
  function requestCloseTab(tabId: string) {
    pendingCloseTabId.value = tabId
    pendingClosePaneId.value = null
    confirmCloseVisible.value = true
  }

  /** Open the close confirmation for a specific pane within a tab */
  function requestClosePane(tabId: string, paneId: string) {
    pendingCloseTabId.value = tabId
    pendingClosePaneId.value = paneId
    confirmCloseVisible.value = true
  }

  /** Dismiss the close confirmation modal and clear pending state */
  function cancelClose() {
    pendingCloseTabId.value = null
    pendingClosePaneId.value = null
    confirmCloseVisible.value = false
  }

  /** Mark user as authenticated after login */
  function setAuthenticated(value: boolean) {
    authenticated.value = value
  }

  return {
    // State
    syncConnected,
    kbVisible,
    settingsOpen,
    authenticated,
    needsSetup,
    pendingCloseTabId,
    pendingClosePaneId,
    confirmCloseVisible,

    // Actions
    requestCloseTab,
    requestClosePane,
    cancelClose,
    setAuthenticated,
  }
})
