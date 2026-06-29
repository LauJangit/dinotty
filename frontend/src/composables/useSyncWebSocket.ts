import { nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import type { SyncServerMsg, SyncClientMsg } from '../types/protocol'
import type { TerminalTab } from '../types/pane'
import { getAllLeaves, findLeaf, migrateTab, ensureSplitRoot } from '../types/pane'
import {
  initializePaneMru,
  reconcilePaneMru,
  removePaneFromMru,
  touchPaneMru,
} from '../types/paneMru'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import {
  getApiBase,
  wsUrlWithToken,
  hasAuthToken,
} from './apiBase'
import { isTauri } from './useTransport'
import { handlePluginChanged } from './usePluginLoader'
import type TerminalPane from '../components/terminal/TerminalPane.vue'

export function useSyncWebSocket(opts: {
  termRefs: Record<string, InstanceType<typeof TerminalPane>>
  persist: () => void
  focusActive: () => void
  newTab: () => Promise<void>
}) {
  const { termRefs, persist, focusActive, newTab } = opts
  const session = useSessionStore()
  const { tabs, activePaneId } = storeToRefs(session)
  const ui = useUiStore()
  const { syncConnected } = storeToRefs(ui)

  let syncWs: WebSocket | null = null
  let suppressSync = false
  let syncReconnectDelay = 1000

  function sendSync(msg: SyncClientMsg) {
    if (syncWs && syncWs.readyState === WebSocket.OPEN && !suppressSync) {
      syncWs.send(JSON.stringify(msg))
    }
  }

  function sendLayoutSync(tabPaneId: string, layout: any, activePaneIdVal: string) {
    sendSync({ type: 'update_layout', pane_id: tabPaneId, layout, active_pane_id: activePaneIdVal })
  }

  function getSavedTab(paneId: string): any {
    try {
      const raw = localStorage.getItem('dinotty_tabs')
      if (!raw) return null
      const { tabs: savedTabs } = JSON.parse(raw)
      const direct = savedTabs?.find((t: any) => t.paneId === paneId)
      if (direct) return direct
      return (
        savedTabs?.find((t: any) => {
          if (!t.layout) return false
          const leaves = getAllLeaves(t.layout)
          return leaves.some((l: any) => l.paneId === paneId)
        }) ?? null
      )
    } catch {
      return null
    }
  }

  async function connectSyncWS() {
    let url: string
    if (isTauri()) {
      const origin = await getApiBase()
      url = `${origin.replace(/^http/, 'ws')}/ws/sync`
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      url = `${proto}//${location.host}/ws/sync`
    }
    const wsUrl = wsUrlWithToken(url)
    if (wsUrl === url && hasAuthToken()) {
      console.warn('[sync] token available but not appended to WS URL')
    }
    syncWs = new WebSocket(wsUrl)

    syncWs.onopen = () => {
      console.log('[sync] connected')
      syncConnected.value = true
      syncReconnectDelay = 1000
    }

    syncWs.onmessage = (e) => {
      let msg: SyncServerMsg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }

      if (msg.type === 'tab_list') {
        const localLeafIds = new Set<string>()
        const localTabIds = new Set<string>()
        for (const t of tabs.value) {
          if (t.type === 'terminal') {
            localTabIds.add(t.paneId)
            for (const leaf of getAllLeaves(t.layout)) {
              localLeafIds.add(leaf.paneId)
            }
          }
        }

        for (const tab of msg.tabs) {
          if (
            !localLeafIds.has(tab.pane_id) &&
            !localTabIds.has(tab.pane_id) &&
            !localTabIds.has(tab.tab_id)
          ) {
            const serverLayout = tab.layout ?? null
            const saved = !serverLayout ? getSavedTab(tab.pane_id) : null
            const migrated = saved ? migrateTab(saved) : null
            tabs.value.push({
              type: 'terminal',
              paneId: tab.tab_id,
              layout: ensureSplitRoot(
                serverLayout ??
                  migrated?.layout ?? {
                    type: 'leaf',
                    paneId: tab.pane_id,
                    title: 'Terminal',
                    ratio: 1,
                    zoomed: false,
                  }
              ),
              activePaneId: tab.active_pane_id ?? migrated?.activePaneId ?? tab.pane_id,
              paneMru: initializePaneMru(
                getAllLeaves(
                  ensureSplitRoot(
                    serverLayout ??
                      migrated?.layout ?? {
                        type: 'leaf',
                        paneId: tab.pane_id,
                        title: 'Terminal',
                        ratio: 1,
                        zoomed: false,
                      }
                  )
                ).map((leaf) => leaf.paneId),
                tab.active_pane_id ?? migrated?.activePaneId ?? tab.pane_id
              ),
              broadcastMode: false,
              broadcastActivity: 0,
              previewVisible: migrated?.previewVisible ?? false,
              previewAddress: migrated?.previewAddress ?? '',
              previewUrl: migrated?.previewUrl ?? '',
              previewKind: migrated?.previewKind ?? 'web',
              customTitle: migrated?.customTitle,
            })
          }
        }

        // Restore plugin tabs from localStorage
        try {
          const raw = localStorage.getItem('dinotty_tabs')
          if (raw) {
            const { tabs: savedTabs } = JSON.parse(raw)
            for (const st of savedTabs) {
              if (st.type === 'plugin' && !tabs.value.some((t) => t.paneId === st.paneId)) {
                tabs.value.push({
                  type: 'plugin',
                  paneId: st.paneId,
                  title: st.title || st.pluginId,
                  pluginId: st.pluginId,
                })
              }
            }
          }
        } catch {
          /* noop */
        }

        // Remove terminal tabs whose leaf paneIds are no longer on the server
        const serverTabIds = new Set(msg.tabs.map((t) => t.tab_id))
        const serverLeafIds = new Set(
          msg.tabs.flatMap((t) => (t.layout ? getAllLeaves(t.layout).map((l) => l.paneId) : []))
        )
        tabs.value = tabs.value.filter((t) => {
          if (t.type === 'plugin') return true
          return (
            serverTabIds.has(t.paneId) ||
            getAllLeaves(t.layout).some((l) => serverLeafIds.has(l.paneId))
          )
        })

        if (msg.active_pane_id) {
          const cur = tabs.value.find((t) => t.paneId === activePaneId.value)
          if (!cur || cur.type !== 'plugin') {
            const targetTab = tabs.value.find((t) => {
              if (t.type !== 'terminal') return false
              return !!findLeaf(t.layout, msg.active_pane_id!)
            }) as TerminalTab | undefined
            if (targetTab) {
              suppressSync = true
              targetTab.activePaneId = msg.active_pane_id
              activePaneId.value = targetTab.paneId
              suppressSync = false
            }
          }
        }

        if (msg.tabs.length === 0 && tabs.value.length === 0) {
          newTab()
        }

        if (!activePaneId.value || !tabs.value.some((t) => t.paneId === activePaneId.value)) {
          if (tabs.value.length > 0) {
            activePaneId.value = tabs.value[0].paneId
          }
        }

        persist()
        nextTick(() => focusActive())
      } else if (msg.type === 'tab_created') {
        const exists = tabs.value.some((t) => {
          if (t.type !== 'terminal') return false
          return t.paneId === msg.tab_id || !!findLeaf(t.layout, msg.pane_id)
        })
        if (!exists) {
          const layout = msg.layout
            ? ensureSplitRoot(msg.layout)
            : ensureSplitRoot({
                type: 'leaf',
                paneId: msg.pane_id,
                title: 'Terminal',
                ratio: 1,
                zoomed: false,
              })
          tabs.value.push({
            type: 'terminal',
            paneId: msg.tab_id,
            layout,
            activePaneId: msg.pane_id,
            paneMru: [msg.pane_id],
            broadcastMode: false,
            broadcastActivity: 0,
            previewVisible: false,
            previewAddress: '',
            previewUrl: '',
            previewKind: 'web',
          })
          activePaneId.value = msg.tab_id
          persist()
          nextTick(() => focusActive())
        }
      } else if (msg.type === 'tab_closed') {
        let tabIdx = tabs.value.findIndex((t) => t.type === 'terminal' && t.paneId === msg.pane_id)
        if (tabIdx === -1) {
          tabIdx = tabs.value.findIndex(
            (t) => t.type === 'terminal' && !!findLeaf(t.layout, msg.pane_id)
          )
        }
        if (tabIdx !== -1) {
          const tab = tabs.value[tabIdx] as TerminalTab
          for (const leaf of getAllLeaves(tab.layout)) {
            delete termRefs[leaf.paneId]
          }
          tabs.value.splice(tabIdx, 1)
          if (tabs.value.length === 0) {
            newTab()
          } else if (activePaneId.value === tab.paneId) {
            activePaneId.value = tabs.value[Math.min(tabIdx, tabs.value.length - 1)].paneId
            persist()
            nextTick(() => focusActive())
          }
        }
      } else if (msg.type === 'tab_activated') {
        const cur = tabs.value.find((t) => t.paneId === activePaneId.value)
        if (!cur || cur.type !== 'plugin') {
          const targetTab = tabs.value.find((t) => {
            if (t.type !== 'terminal') return false
            return !!findLeaf(t.layout, msg.pane_id)
          }) as TerminalTab | undefined
          if (targetTab) {
            suppressSync = true
            targetTab.paneMru = touchPaneMru(targetTab.paneMru, msg.pane_id)
            targetTab.activePaneId = msg.pane_id
            activePaneId.value = targetTab.paneId
            suppressSync = false
          }
        }
      } else if (msg.type === 'layout_updated') {
        const targetTab = tabs.value.find((t) => {
          if (t.type !== 'terminal') return false
          if (t.paneId === msg.pane_id) return true
          const incomingLeafIds = getAllLeaves(msg.layout).map((l: any) => l.paneId)
          const localLeafIds = getAllLeaves(t.layout).map((l) => l.paneId)
          return incomingLeafIds.some((id: string) => localLeafIds.includes(id))
        }) as TerminalTab | undefined
        if (targetTab) {
          const incomingLeafIds = getAllLeaves(msg.layout).map((l: any) => l.paneId)
          const localLeafIds = getAllLeaves(targetTab.layout).map((l) => l.paneId)
          const sameLeaves =
            incomingLeafIds.length === localLeafIds.length &&
            incomingLeafIds.every((id: string) => localLeafIds.includes(id))
          const removedPaneIds = localLeafIds.filter((id) => !incomingLeafIds.includes(id))
          const previousActivePaneId = targetTab.activePaneId
          const activePaneWasRemoved = removedPaneIds.includes(previousActivePaneId)

          suppressSync = true
          if (!sameLeaves) {
            targetTab.layout = ensureSplitRoot(msg.layout)
          }
          for (const removedPaneId of removedPaneIds) {
            targetTab.paneMru = removePaneFromMru(
              targetTab.paneMru,
              removedPaneId
            ).paneMru
          }
          targetTab.paneMru = reconcilePaneMru(
            targetTab.paneMru,
            incomingLeafIds,
            previousActivePaneId
          )
          if (activePaneWasRemoved) {
            targetTab.activePaneId = targetTab.paneMru[0] ?? msg.active_pane_id
          } else if (incomingLeafIds.includes(msg.active_pane_id)) {
            targetTab.activePaneId = msg.active_pane_id
            targetTab.paneMru = touchPaneMru(targetTab.paneMru, msg.active_pane_id)
          } else {
            targetTab.activePaneId = previousActivePaneId
          }
          suppressSync = false

          if (activePaneWasRemoved && targetTab.activePaneId !== msg.active_pane_id) {
            sendLayoutSync(targetTab.paneId, targetTab.layout, targetTab.activePaneId)
          }

          const updatedLeafIds = new Set(getAllLeaves(targetTab.layout).map((l) => l.paneId))
          tabs.value = tabs.value.filter((t) => {
            if (t.type !== 'terminal') return true
            if (t.paneId === targetTab.paneId) return true
            const leaves = getAllLeaves(t.layout)
            return !leaves.every((l) => updatedLeafIds.has(l.paneId))
          })

          persist()
          nextTick(() => {
            getAllLeaves(targetTab.layout).forEach((l) => termRefs[l.paneId]?.fit())
            if (activePaneId.value === targetTab.paneId) {
              focusActive()
            }
          })
        }
      } else if (msg.type === 'plugin_changed') {
        handlePluginChanged(msg.plugin_id, msg.change)
      }
    }

    syncWs.onclose = (e) => {
      console.warn('[sync] disconnected', e.code, e.reason)
      syncWs = null
      syncConnected.value = false
      setTimeout(connectSyncWS, syncReconnectDelay)
      syncReconnectDelay = Math.min(syncReconnectDelay * 2, 30000)
    }

    syncWs.onerror = (e) => {
      console.error('[sync] error', e)
    }
  }

  function closeWs() {
    if (syncWs) {
      syncWs.close()
      syncWs = null
    }
  }

  function isConnected(): boolean {
    return !!syncWs && syncWs.readyState === WebSocket.OPEN
  }

  return {
    sendSync,
    sendLayoutSync,
    connectSyncWS,
    closeWs,
    isConnected,
    get suppressSync() {
      return suppressSync
    },
    set suppressSync(v: boolean) {
      suppressSync = v
    },
  }
}
