import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PaneLayout, TerminalTab } from '../types/pane'

let socket: MockWebSocket
class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    socket = this
  }
}
vi.stubGlobal('WebSocket', MockWebSocket)

vi.mock('../composables/apiBase', () => ({
  getApiBase: async () => 'http://localhost',
  wsUrlWithToken: (url: string) => url,
  hasAuthToken: () => false,
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))
vi.mock('../composables/usePluginLoader', () => ({ handlePluginChanged: vi.fn() }))

import { useSyncWebSocket } from '../composables/useSyncWebSocket'
import { useSessionStore } from '../stores/sessionStore'

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false }
}

function layout(...ids: string[]): PaneLayout {
  return {
    type: 'split',
    id: 'root',
    direction: 'horizontal',
    children: ids.map(leaf),
    ratios: ids.map(() => 1 / ids.length),
  }
}

function makeTab(): TerminalTab {
  return {
    type: 'terminal',
    paneId: 'tab-1',
    layout: layout('a', 'b', 'c'),
    activePaneId: 'b',
    paneMru: ['b', 'a', 'c'],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
  }
}

async function setup() {
  setActivePinia(createPinia())
  const session = useSessionStore()
  const tab = makeTab()
  session.tabs = [tab]
  session.activePaneId = tab.paneId
  const focusActive = vi.fn()
  const subject = useSyncWebSocket({
    termRefs: {},
    persist: vi.fn(),
    focusActive,
    newTab: vi.fn(),
  })
  await subject.connectSyncWS()
  const emitLayout = (nextLayout: PaneLayout, serverActivePaneId: string) => {
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'layout_updated',
        pane_id: tab.paneId,
        layout: nextLayout,
        active_pane_id: serverActivePaneId,
      }),
    })
  }
  return { tab, emitLayout, focusActive }
}

describe('useSyncWebSocket pane MRU', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses and focuses the MRU fallback when a focused pane exits', async () => {
    const { tab, emitLayout, focusActive } = await setup()
    emitLayout(layout('a', 'c'), 'c')
    await Promise.resolve()
    expect(tab.paneMru).toEqual(['a', 'c'])
    expect(tab.activePaneId).toBe('a')
    expect(focusActive).toHaveBeenCalledOnce()
  })

  it('preserves focus when a non-focused pane exits', async () => {
    const { tab, emitLayout } = await setup()
    emitLayout(layout('a', 'b'), 'b')
    expect(tab.paneMru).toEqual(['b', 'a'])
    expect(tab.activePaneId).toBe('b')
  })

  it('applies a pane focus change received from another client', async () => {
    const { tab, emitLayout, focusActive } = await setup()
    emitLayout(layout('a', 'b', 'c'), 'c')
    await Promise.resolve()
    expect(tab.paneMru).toEqual(['c', 'b', 'a'])
    expect(tab.activePaneId).toBe('c')
    expect(focusActive).toHaveBeenCalledOnce()
  })

  it('keeps the synchronized focus when another client closes a non-focused pane', async () => {
    const { tab, emitLayout } = await setup()
    emitLayout(layout('a', 'b', 'c'), 'c')
    emitLayout(layout('a', 'c'), 'c')
    expect(tab.paneMru).toEqual(['c', 'a'])
    expect(tab.activePaneId).toBe('c')
  })

  it('keeps MRU unique after a duplicate layout message', async () => {
    const { tab, emitLayout } = await setup()
    tab.paneMru = ['b', 'b', 'a', 'c']
    emitLayout(layout('a', 'b', 'c'), 'b')
    expect(tab.paneMru).toEqual(['b', 'a', 'c'])
  })
})
