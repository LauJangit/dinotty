import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket)

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('sessionStorage', memoryStorage())

const transportMock = vi.hoisted(() => ({ tauri: false }))
const reloadMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('location', {
  protocol: 'http:',
  host: 'localhost',
  reload: reloadMock,
})

vi.mock('vue-toastification', () => ({
  TYPE: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}))

vi.mock('../useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../useTransport', () => ({ isTauri: () => transportMock.tauri }))

vi.mock('../apiBase', () => ({
  getApiBase: async () => 'http://127.0.0.1:28999',
  wsUrlWithToken: (url: string) => url,
}))

import { settings } from '../useSettings'
import {
  __dispatchServerMessageForTest,
  __pendingRequestCountForTest,
  __resetForTest,
  useNotification,
  type NotificationItem,
} from '../useNotification'

function snapshot(
  revision: string,
  panes: Array<{
    paneId: string
    latestEventSeq: string
    readThroughSeq: string
    severity: string | null
  }> = [],
  notifs: Array<{ notifId: string; read: boolean }> = [],
  epoch = 'epoch-a'
) {
  return {
    type: 'snapshot',
    epoch,
    revision,
    panes: panes.map((pane) => ({ ...pane, firstUnreadAt: 100 })),
    notifs,
  }
}

function delta(
  revision: string,
  panes: Array<{
    paneId: string
    latestEventSeq: string
    readThroughSeq: string
    severity: string | null
  }> = [],
  notifs: Array<{ notifId: string; read: boolean }> = []
) {
  return {
    type: 'state_delta',
    epoch: 'epoch-a',
    revision,
    panes: panes.map((pane) => ({ ...pane, firstUnreadAt: 100 })),
    notifs,
  }
}

function legacyEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'notify',
    v: 1,
    pane_id: 'pane-a',
    title: null,
    body: 'done',
    notification_type: 'info',
    eventSeq: '1',
    occurredAt: 100,
    severity: 'info',
    ...overrides,
  }
}

function current() {
  return useNotification()
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetForTest()
  FakeWebSocket.instances = []
  localStorage.clear()
  sessionStorage.clear()
  transportMock.tauri = false
  reloadMock.mockReset()
  ;(settings as any).notification = {
    enabled: true,
    osc_notify: true,
    bell: { enabled: true },
    channels: { sound: false, vibration: false, panel: false },
    sounds: {},
  }
})

afterEach(() => {
  __resetForTest()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useNotification protocol dispatcher', () => {
  it('connects to protocol v1 and dispatches state, resync, snapshot, ack, and legacy envelopes', () => {
    const notif = current()
    expect(FakeWebSocket.instances[0].url).toContain('/ws/notify?v=1')

    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '2', readThroughSeq: '0', severity: 'error' },
      ])
    )
    expect(notif.unreadByPane['pane-a']).toBe('error')

    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    expect(notif.unreadAttentionCount.value).toBe(0)

    const payload = JSON.parse(FakeWebSocket.instances[0].sent[0])
    expect(payload).toMatchObject({
      type: 'notification.mark_read',
      v: 1,
      epoch: 'epoch-a',
      reason: 'focus',
      panes: [{ paneId: 'pane-a', throughEventSeq: '2' }],
      notifs: [],
    })
    expect(payload.clientId).toEqual(expect.any(String))
    expect(payload.requestId).toEqual(expect.any(String))
    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: payload.requestId,
      epoch: 'epoch-a',
      appliedAtRevision: null,
      results: [{ target: { paneId: 'pane-a' }, status: 'conflict' }],
    })
    expect(notif.unreadAttentionCount.value).toBe(1)

    __dispatchServerMessageForTest({ type: 'resync_required', v: 1 })
    __dispatchServerMessageForTest(
      delta('2', [{ paneId: 'pane-a', latestEventSeq: '2', readThroughSeq: '2', severity: null }])
    )
    expect(notif.unreadAttentionCount.value).toBe(1)

    __dispatchServerMessageForTest(
      snapshot('2', [
        { paneId: 'pane-a', latestEventSeq: '2', readThroughSeq: '2', severity: null },
      ])
    )
    expect(notif.unreadAttentionCount.value).toBe(0)

    __dispatchServerMessageForTest(legacyEvent())
    expect(notif.historyCount.value).toBe(1)
  })

  it('bounds ack-timeout resends and rolls back the overlay after exhaustion', async () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '7', readThroughSeq: '0', severity: 'warning' },
      ])
    )

    notif.markPanesRead([{ paneId: 'pane-a' }], 'terminal_input')
    expect(socket.sent).toHaveLength(1)
    expect(notif.unreadAttentionCount.value).toBe(0)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(socket.sent).toHaveLength(4)
    expect(new Set(socket.sent).size).toBe(1)
    expect(notif.unreadAttentionCount.value).toBe(0)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(socket.sent).toHaveLength(4)
    expect(notif.unreadAttentionCount.value).toBe(1)
  })

  it('deduplicates history by epoch plus pane sequence or pane-less notif identity', () => {
    const notif = current()
    __dispatchServerMessageForTest(snapshot('1'))

    __dispatchServerMessageForTest(legacyEvent())
    __dispatchServerMessageForTest(legacyEvent())
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '9', body: 'plugin' })
    )
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '10', body: 'plugin duplicate' })
    )
    expect(notif.historyCount.value).toBe(2)

    __dispatchServerMessageForTest(snapshot('0', [], [], 'epoch-b'))
    __dispatchServerMessageForTest(legacyEvent())
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '11', body: 'new epoch' })
    )
    expect(notif.historyCount.value).toBe(4)
  })

  it('keeps authoritative attention count independent from history count', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'urgent' }],
        [{ notifId: 'notif-a', read: false }]
      )
    )
    expect(notif.unreadAttentionCount.value).toBe(2)
    expect(notif.historyCount.value).toBe(0)

    __dispatchServerMessageForTest(legacyEvent())
    expect(notif.unreadAttentionCount.value).toBe(2)
    expect(notif.historyCount.value).toBe(1)
  })

  it('projects firstUnreadAt values alongside unread severity', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'urgent' },
      ])
    )
    expect(notif.firstUnreadAtByPane['pane-a']).toBe(100)

    __dispatchServerMessageForTest(
      delta('2', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '1', severity: null },
      ])
    )
    expect(notif.firstUnreadAtByPane['pane-a']).toBe(100)

    __dispatchServerMessageForTest({
      type: 'state_delta',
      epoch: 'epoch-a',
      revision: '3',
      panes: [
        {
          paneId: 'pane-a',
          latestEventSeq: '1',
          readThroughSeq: '1',
          firstUnreadAt: null,
          severity: null,
        },
      ],
      notifs: [],
    })
    expect(notif.firstUnreadAtByPane['pane-a']).toBeNull()
  })

  it('clearAll sends one combined request with authoritative pane and notif targets', () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '8', readThroughSeq: '2', severity: 'warning' }],
        [{ notifId: 'notif-a', read: false }]
      )
    )

    notif.clearAll()

    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      reason: 'clear_all',
      panes: [{ paneId: 'pane-a', throughEventSeq: '8' }],
      notifs: [{ notifId: 'notif-a' }],
    })
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('stale_epoch cancels every pending overlay', () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'a', latestEventSeq: '1', readThroughSeq: '0', severity: 'info' },
        { paneId: 'b', latestEventSeq: '2', readThroughSeq: '0', severity: 'error' },
      ])
    )
    notif.markPanesRead([{ paneId: 'a' }], 'focus')
    notif.markPanesRead([{ paneId: 'b' }], 'focus')
    expect(notif.unreadAttentionCount.value).toBe(0)

    const firstPayload = JSON.parse(socket.sent[0])
    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: firstPayload.requestId,
      epoch: 'epoch-b',
      appliedAtRevision: null,
      results: [{ target: { paneId: 'a' }, status: 'stale_epoch' }],
    })
    expect(notif.unreadAttentionCount.value).toBe(2)
  })

  it('close 4001 cancels pending timers, restores authoritative state, and reloads the web app once', async () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'error' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    expect(notif.unreadAttentionCount.value).toBe(0)
    expect(__pendingRequestCountForTest()).toBe(1)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    socket.onclose?.({ code: 4001, reason: 'protocol_upgrade_required' } as CloseEvent)
    expect(clearTimeoutSpy).toHaveBeenCalledOnce()
    expect(__pendingRequestCountForTest()).toBe(0)
    expect(notif.unreadAttentionCount.value).toBe(1)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(socket.sent).toHaveLength(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(reloadMock).toHaveBeenCalledOnce()
  })

  it('close 4001 in Tauri cancels pending timers without reload or reconnect', async () => {
    transportMock.tauri = true
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const notif = current()
    await Promise.resolve()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'error' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    socket.onclose?.({ code: 4001, reason: 'protocol_upgrade_required' } as CloseEvent)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(socket.sent).toHaveLength(1)
    expect(__pendingRequestCountForTest()).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(reloadMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('bounds disconnected requests, evicts the oldest at 64, and expires all overlays', async () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    const panes = Array.from({ length: 65 }, (_, index) => ({
      paneId: `pane-${index}`,
      latestEventSeq: String(index + 1),
      readThroughSeq: '0',
      severity: 'warning',
    }))
    __dispatchServerMessageForTest(snapshot('1', panes))
    socket.readyState = 3
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    for (const pane of panes) notif.markPanesRead([{ paneId: pane.paneId }], 'focus')

    expect(socket.sent).toHaveLength(0)
    expect(__pendingRequestCountForTest()).toBe(64)
    expect(notif.unreadAttentionCount.value).toBe(1)
    expect(clearTimeoutSpy).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20_000)
    expect(__pendingRequestCountForTest()).toBe(0)
    expect(notif.unreadAttentionCount.value).toBe(65)
  })

  it('dismisses a stale-epoch history card locally without sending mark_read', () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'info' },
      ])
    )
    __dispatchServerMessageForTest(legacyEvent())
    const item = notif.notifications.value[0]

    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '9', readThroughSeq: '0', severity: 'urgent' }],
        [],
        'epoch-b'
      )
    )
    notif.dismissOne(item.id)

    expect(notif.notifications.value).toHaveLength(0)
    expect(socket.sent).toHaveLength(0)
    expect(notif.unreadAttentionCount.value).toBe(1)
  })

  it('reconnect resend uses the current snapshot epoch', async () => {
    const notif = current()
    const firstSocket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    firstSocket.onclose?.({ code: 1006 } as CloseEvent)
    await vi.advanceTimersByTimeAsync(3000)
    const reconnected = FakeWebSocket.instances[1]
    __dispatchServerMessageForTest(
      snapshot('2', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )

    expect(reconnected.sent).toHaveLength(1)
    expect(JSON.parse(reconnected.sent[0]).epoch).toBe('epoch-a')
  })

  it('drops old-epoch pending entries after reconnect instead of resending them', async () => {
    const notif = current()
    const firstSocket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    firstSocket.onclose?.({ code: 1006 } as CloseEvent)
    await vi.advanceTimersByTimeAsync(3000)
    const reconnected = FakeWebSocket.instances[1]
    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '8', readThroughSeq: '0', severity: 'error' }],
        [],
        'epoch-b'
      )
    )

    expect(reconnected.sent).toHaveLength(0)
    expect(__pendingRequestCountForTest()).toBe(0)
    expect(notif.unreadAttentionCount.value).toBe(1)
  })

  it('keeps retrying through the real disconnected close path until the overlay expires', async () => {
    const notif = current()
    const firstSocket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )

    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    expect(__pendingRequestCountForTest()).toBe(1)
    expect(notif.unreadAttentionCount.value).toBe(0)
    firstSocket.onclose?.({ code: 1006 } as CloseEvent)

    await vi.advanceTimersByTimeAsync(20_000)

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(notif.unreadAttentionCount.value).toBe(1)
    expect(firstSocket.sent).toHaveLength(1)
    expect(FakeWebSocket.instances[1].sent).toHaveLength(0)
  })

  it('counts a retry in the reconnect pre-snapshot window but waits for snapshot to send', async () => {
    const notif = current()
    const firstSocket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' }],
        [],
        'epoch-current'
      )
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    expect(firstSocket.sent).toHaveLength(1)

    firstSocket.onclose?.({ code: 1006 } as CloseEvent)
    await vi.advanceTimersByTimeAsync(5000)
    const reconnected = FakeWebSocket.instances[1]
    expect(reconnected.sent).toHaveLength(0)

    __dispatchServerMessageForTest(
      snapshot(
        '2',
        [{ paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' }],
        [],
        'epoch-current'
      )
    )

    expect(reconnected.sent).toHaveLength(1)
    expect(JSON.parse(reconnected.sent[0])).toMatchObject({ epoch: 'epoch-current' })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(reconnected.sent).toHaveLength(2)
    expect(__pendingRequestCountForTest()).toBe(0)
  })

  it('cancels the resend timer when mark_read_result arrives', async () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    const payload = JSON.parse(socket.sent[0])

    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: payload.requestId,
      epoch: 'epoch-a',
      appliedAtRevision: '2',
      results: [{ target: { paneId: 'pane-a' }, status: 'applied' }],
    })
    await vi.advanceTimersByTimeAsync(20_000)

    expect(socket.sent).toHaveLength(1)
    expect(__pendingRequestCountForTest()).toBe(0)
  })

  it('retires a proved overlay through snapshot message dispatch', async () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    __dispatchServerMessageForTest(
      snapshot('2', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '3', severity: null },
      ])
    )
    await vi.advanceTimersByTimeAsync(20_000)

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(socket.sent).toHaveLength(1)
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('retires and cancels a proved overlay through delta message dispatch', async () => {
    const notif = current()
    const socket = FakeWebSocket.instances[0]
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    __dispatchServerMessageForTest(
      delta('2', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '3', severity: null },
      ])
    )
    await vi.advanceTimersByTimeAsync(20_000)

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(socket.sent).toHaveLength(1)
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('keeps the history item identity fields from legacy envelopes', () => {
    const notif = current()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(legacyEvent({ eventSeq: '55', notifId: undefined }))
    const item = notif.notifications.value[0] as NotificationItem
    expect(item.eventSeq).toBe('55')
    expect(item.notifId).toBeUndefined()
  })
})
