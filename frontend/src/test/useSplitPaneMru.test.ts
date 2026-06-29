import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PaneLayout, Tab, TerminalTab } from '../types/pane'

const api = vi.hoisted(() => ({
  split: vi.fn(),
  close: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiSplitPane: api.split,
  apiClosePane: api.close,
}))
vi.mock('../composables/useTerminal', () => ({ setActivePaneId: vi.fn() }))

import { useSplitPane } from '../composables/useSplitPane'

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

function setup() {
  const tab: TerminalTab = {
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
  const tabs = ref<Tab[]>([tab])
  const termRefs = Object.fromEntries(
    ['a', 'b', 'c', 'd'].map((id) => [
      id,
      { focus: vi.fn(), blur: vi.fn(), fit: vi.fn(), sendData: vi.fn() },
    ])
  ) as any
  const subject = useSplitPane({
    tabs,
    activePaneId: ref<string | null>('tab-1'),
    termRefs,
    genPaneId: () => 'd',
    sendSync: vi.fn(),
    sendLayoutSync: vi.fn(),
    persist: vi.fn(),
  })
  return { tab, subject }
}

describe('useSplitPane MRU', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prepends the pane created and focused by splitPane', async () => {
    const { tab, subject } = setup()
    api.split.mockResolvedValue({ new_pane_id: 'd', layout: layout('a', 'b', 'c', 'd') })
    await subject.splitPane('horizontal')
    expect(tab.paneMru).toEqual(['d', 'b', 'a', 'c'])
    expect(tab.activePaneId).toBe('d')
  })

  it('moves an existing pane to the MRU head on focus', () => {
    const { tab, subject } = setup()
    subject.focusPane('a')
    expect(tab.paneMru).toEqual(['a', 'b', 'c'])
    expect(tab.activePaneId).toBe('a')
  })

  it('focuses the next MRU pane when the active pane closes', async () => {
    const { tab, subject } = setup()
    api.close.mockResolvedValue({
      ok: true,
      tab_closed: false,
      layout: layout('a', 'c'),
      active_pane_id: 'c',
    })
    await subject.closePane('b')
    expect(tab.paneMru).toEqual(['a', 'c'])
    expect(tab.activePaneId).toBe('a')
  })

  it('preserves focus when a non-active pane closes', async () => {
    const { tab, subject } = setup()
    api.close.mockResolvedValue({
      ok: true,
      tab_closed: false,
      layout: layout('a', 'b'),
      active_pane_id: 'a',
    })
    await subject.closePane('c')
    expect(tab.paneMru).toEqual(['b', 'a'])
    expect(tab.activePaneId).toBe('b')
  })

  it('does not mutate state when close fails', async () => {
    const { tab, subject } = setup()
    const before = JSON.stringify(tab)
    api.close.mockRejectedValue(new Error('network'))
    expect(await subject.closePane('b')).toBe(false)
    expect(JSON.stringify(tab)).toBe(before)
  })
})
