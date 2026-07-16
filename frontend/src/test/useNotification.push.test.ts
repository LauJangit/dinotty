import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub WebSocket - useNotification() triggers connectWs() on first call.
vi.stubGlobal(
  'WebSocket',
  class {
    onopen: any = null
    onmessage: any = null
    onclose: any = null
    onerror: any = null
    close() {}
    send() {}
  }
)

// Mock dependencies before importing useNotification.
vi.mock('vue-toastification', () => ({
  TYPE: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}))

vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))

vi.mock('../composables/apiBase', () => ({
  getApiBase: async () => 'http://127.0.0.1:28999',
  wsUrlWithToken: (url: string) => url,
}))

import { settings } from '../composables/useSettings'
import {
  __dispatchServerMessageForTest,
  __resetForTest,
  useNotification,
  pushNotification,
  setToastInstance,
  type NotificationItem,
} from '../composables/useNotification'

const toastSpy = vi.fn()

function setConfig(overrides: Record<string, unknown> = {}) {
  ;(settings as any).notification = {
    enabled: true,
    osc_notify: true,
    bell: { enabled: true },
    channels: { sound: false, vibration: false, panel: false },
    sounds: {},
    ...overrides,
  }
}

function listNotifications(): NotificationItem[] {
  return (useNotification() as any).notifications.value as NotificationItem[]
}

function unreadByPane(): Record<string, string> {
  return (useNotification() as any).unreadByPane as Record<string, string>
}

describe('pushNotification - plugin notify path', () => {
  beforeEach(() => {
    __resetForTest()
    setConfig()
    toastSpy.mockClear()
    setToastInstance(toastSpy)
  })

  it('appends item to notifications array', () => {
    pushNotification({ type: 'info', body: 'hello', source: 'plugin' })
    const list = listNotifications()
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('hello')
    expect(list[0].source).toBe('plugin')
    expect(list[0].paneId).toBeUndefined()
  })

  it('does NOT touch unreadByPane when paneId is absent (plugin notification)', () => {
    pushNotification({ type: 'error', body: 'no pane', source: 'plugin' })
    expect(Object.keys(unreadByPane())).toHaveLength(0)
  })

  it('keeps unreadByPane authoritative even when a local push carries paneId', () => {
    pushNotification({ type: 'error', body: 'with pane', paneId: 'pane-1' })
    expect(unreadByPane()['pane-1']).toBeUndefined()

    __dispatchServerMessageForTest({
      type: 'snapshot',
      epoch: 'test-epoch',
      revision: '1',
      panes: [
        {
          paneId: 'pane-1',
          latestEventSeq: '1',
          readThroughSeq: '0',
          firstUnreadAt: 1,
          severity: 'error',
        },
      ],
      notifs: [],
    })
    expect(unreadByPane()['pane-1']).toBe('error')
  })

  it('respects master enabled=false switch', () => {
    setConfig({ enabled: false })
    pushNotification({ type: 'info', body: 'should be skipped' })
    expect(listNotifications()).toHaveLength(0)
  })

  it('defaults source to terminal when not specified', () => {
    pushNotification({ type: 'info', body: 'default source' })
    expect(listNotifications()[0].source).toBe('terminal')
  })

  it('maps title=null when title not provided', () => {
    pushNotification({ type: 'info', body: 'no title' })
    expect(listNotifications()[0].title).toBeNull()
  })

  it('passes through title when provided', () => {
    pushNotification({ type: 'info', body: 'x', title: 'My Plugin' })
    expect(listNotifications()[0].title).toBe('My Plugin')
  })

  it('caps notifications at 100 entries', () => {
    for (let i = 0; i < 105; i++) {
      pushNotification({ type: 'info', body: `n${i}` })
    }
    expect(listNotifications()).toHaveLength(100)
  })

  it('shows toast even when channels.panel is false (plugin notify not gated by panel)', () => {
    toastSpy.mockClear()
    setConfig({ channels: { sound: false, vibration: false, panel: false } })
    pushNotification({ type: 'info', body: 'should still toast', source: 'plugin' })
    expect(toastSpy).toHaveBeenCalled()
  })

  it('does NOT show toast when master enabled=false', () => {
    toastSpy.mockClear()
    setConfig({ enabled: false })
    pushNotification({ type: 'info', body: 'should skip' })
    expect(toastSpy).not.toHaveBeenCalled()
  })
})
