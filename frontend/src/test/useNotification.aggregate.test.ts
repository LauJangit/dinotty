import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  aggregateSeverity,
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

function seedUnread(entries: Array<[string, string, string]>) {
  __dispatchServerMessageForTest({
    type: 'snapshot',
    epoch: 'test-epoch',
    revision: '1',
    panes: entries.map(([paneId, latestEventSeq, severity]) => ({
      paneId,
      latestEventSeq,
      readThroughSeq: '0',
      firstUnreadAt: 1,
      severity,
    })),
    notifs: [],
  })
}

describe('aggregateSeverity', () => {
  beforeEach(() => {
    __resetForTest()
    setConfig()
    toastSpy.mockClear()
    setToastInstance(toastSpy)
  })

  it('returns null for empty paneIds', () => {
    expect(aggregateSeverity([])).toBeNull()
  })

  it('returns null when no pane has unread', () => {
    seedUnread([['pane-a', '1', 'error']])
    expect(aggregateSeverity(['pane-b', 'pane-c'])).toBeNull()
  })

  it('returns the severity when single pane has unread', () => {
    seedUnread([['pane-a', '1', 'warning']])
    expect(aggregateSeverity(['pane-a'])).toBe('warning')
  })

  it('returns highest severity across multiple panes', () => {
    seedUnread([
      ['leaf-1', '1', 'info'],
      ['leaf-2', '2', 'error'],
      ['leaf-3', '3', 'warning'],
    ])
    expect(aggregateSeverity(['leaf-1', 'leaf-2', 'leaf-3'])).toBe('error')
  })

  it('urgent beats error', () => {
    seedUnread([
      ['leaf-1', '1', 'error'],
      ['leaf-2', '2', 'urgent'],
    ])
    expect(aggregateSeverity(['leaf-1', 'leaf-2'])).toBe('urgent')
  })

  it('aggregates tab-level paneId together with leaf paneIds (split-pane scenario)', () => {
    seedUnread([
      ['tab-1', '1', 'info'],
      ['leaf-2', '2', 'error'],
    ])
    const sev = aggregateSeverity(['tab-1', 'leaf-1', 'leaf-2'])
    expect(sev).toBe('error')
  })
})

describe('clearForPaneIds', () => {
  beforeEach(() => {
    __resetForTest()
    setConfig()
    toastSpy.mockClear()
    setToastInstance(toastSpy)
  })

  it('removes unreadByPane entries for given paneIds', () => {
    seedUnread([
      ['pane-a', '1', 'error'],
      ['pane-b', '2', 'info'],
    ])
    pushNotification({ type: 'error', body: 'x', paneId: 'pane-a' })
    pushNotification({ type: 'info', body: 'x', paneId: 'pane-b' })
    expect(Object.keys(unreadByPane())).toHaveLength(2)

    useNotification().clearForPaneIds(['pane-a'])
    expect(unreadByPane()['pane-a']).toBeUndefined()
    expect(unreadByPane()['pane-b']).toBe('info')
  })

  it('removes notifications whose paneId is in the set', () => {
    seedUnread([
      ['pane-a', '1', 'error'],
      ['pane-b', '2', 'info'],
    ])
    pushNotification({ type: 'error', body: 'x', paneId: 'pane-a' })
    pushNotification({ type: 'info', body: 'x', paneId: 'pane-b' })

    useNotification().clearForPaneIds(['pane-a'])
    const remaining = listNotifications()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].paneId).toBe('pane-b')
  })

  it('clears both tab-level and leaf paneIds in one call (closeTab scenario)', () => {
    seedUnread([
      ['leaf-1', '1', 'error'],
      ['leaf-2', '2', 'warning'],
      ['pane-x', '3', 'info'],
    ])
    pushNotification({ type: 'error', body: 'leaf1', paneId: 'leaf-1' })
    pushNotification({ type: 'warning', body: 'leaf2', paneId: 'leaf-2' })
    pushNotification({ type: 'info', body: 'other', paneId: 'pane-x' })

    useNotification().clearForPaneIds(['tab-1', 'leaf-1', 'leaf-2'])
    expect(unreadByPane()['tab-1']).toBeUndefined()
    expect(unreadByPane()['leaf-1']).toBeUndefined()
    expect(unreadByPane()['leaf-2']).toBeUndefined()
    expect(unreadByPane()['pane-x']).toBe('info')
    expect(listNotifications()).toHaveLength(1)
  })

  it('preserves notifications with no paneId (broadcast notifications)', () => {
    seedUnread([['pane-a', '1', 'error']])
    pushNotification({ type: 'info', body: 'no pane', source: 'plugin' })
    pushNotification({ type: 'error', body: 'with pane', paneId: 'pane-a' })

    useNotification().clearForPaneIds(['pane-a'])
    const remaining = listNotifications()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].body).toBe('no pane')
  })

  it('is a no-op for unknown paneIds', () => {
    seedUnread([['pane-a', '1', 'error']])
    pushNotification({ type: 'error', body: 'x', paneId: 'pane-a' })
    useNotification().clearForPaneIds(['nonexistent'])
    expect(unreadByPane()['pane-a']).toBe('error')
    expect(listNotifications()).toHaveLength(1)
  })
})
