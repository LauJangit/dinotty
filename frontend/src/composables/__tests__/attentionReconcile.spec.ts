import { describe, expect, it } from 'vitest'
import { createAttentionStore, type AttentionStateEnvelope } from '../attentionReconcile'

function state(
  revision: string,
  panes: AttentionStateEnvelope['panes'] = [],
  notifs: AttentionStateEnvelope['notifs'] = [],
  epoch = 'epoch-a'
): AttentionStateEnvelope {
  return { epoch, revision, panes, notifs }
}

function pane(
  paneId: string,
  latestEventSeq: string,
  readThroughSeq: string,
  severity = 'warning'
) {
  return {
    paneId,
    latestEventSeq,
    readThroughSeq,
    firstUnreadAt: latestEventSeq === readThroughSeq ? null : 100,
    severity: latestEventSeq === readThroughSeq ? null : severity,
  }
}

describe('attentionReconcile', () => {
  it('uses BigInt revision gates and accepts equal-revision snapshots', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('9007199254740993', [pane('p', '9', '0')]))

    expect(store.applyDelta(state('9007199254740992', [pane('p', '10', '0')]))).toBe(false)
    expect(store.applyDelta(state('9007199254740993', [pane('p', '10', '0')]))).toBe(false)
    expect(store.panes.get('p')?.latestEventSeq).toBe(9n)

    expect(store.applySnapshot(state('9007199254740993', [pane('p', '11', '0')]))).toBe(true)
    expect(store.panes.get('p')?.latestEventSeq).toBe(11n)
  })

  it('discards interim deltas while awaiting a recovery snapshot', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('1', [pane('p', '1', '0')]))
    store.noteResyncRequired()

    expect(store.awaitingSnapshot).toBe(true)
    expect(store.applyDelta(state('2', [pane('p', '2', '0')]))).toBe(false)
    expect(store.cacheRevision).toBe(1n)

    store.applySnapshot(state('2', [pane('p', '2', '2')]))
    expect(store.awaitingSnapshot).toBe(false)
    expect(store.cacheRevision).toBe(2n)
    expect(store.unreadAttentionCount()).toBe(0)
  })

  it('treats a foreign-epoch delta defensively and adopts the next snapshot', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('4', [pane('old', '4', '0')]))

    store.applyDelta(state('5', [pane('foreign', '5', '0')], [], 'epoch-b'))
    expect(store.awaitingSnapshot).toBe(true)
    expect(store.epoch).toBe('epoch-a')

    store.applySnapshot(state('0', [pane('new', '1', '0')], [], 'epoch-b'))
    expect(store.epoch).toBe('epoch-b')
    expect(store.cacheRevision).toBe(0n)
    expect([...store.panes.keys()]).toEqual(['new'])
  })

  it('changes epoch by replacing the baseline and cancelling old overlays', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('8', [pane('old', '8', '0')]))
    store.addOverlay('request-old', [{ paneId: 'old', throughEventSeq: 8n }])
    expect(store.unreadAttentionCount()).toBe(0)

    store.applySnapshot(state('1', [pane('new', '1', '0')], [], 'epoch-b'))
    expect(store.overlays.size).toBe(0)
    expect(store.panes.has('old')).toBe(false)
    expect(store.unreadPaneSeverities()).toEqual({ new: 'warning' })
  })

  it('masks only through the pane overlay watermark', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('1', [pane('p', '5', '0')]))
    store.addOverlay('read-5', [{ paneId: 'p', throughEventSeq: 5n }])
    expect(store.unreadPaneSeverities()).toEqual({})

    store.applyDelta(state('2', [pane('p', '6', '0', 'urgent')]))
    expect(store.unreadPaneSeverities()).toEqual({ p: 'urgent' })
  })

  it('applies every pane in a single revision transaction', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('1'))
    store.applyDelta(state('2', [pane('a', '2', '0', 'info'), pane('b', '3', '0', 'error')]))

    expect(store.cacheRevision).toBe(2n)
    expect(store.unreadPaneSeverities()).toEqual({ a: 'info', b: 'error' })
  })

  it('clears pane aggregate fields when a full delta row contains nulls', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('1', [pane('p', '5', '0', 'urgent')]))

    store.applyDelta(
      state('2', [
        {
          paneId: 'p',
          latestEventSeq: '5',
          readThroughSeq: '5',
          firstUnreadAt: null,
          severity: null,
        },
      ])
    )

    expect(store.panes.get('p')).toMatchObject({ firstUnreadAt: null, severity: null })
    expect(store.firstUnreadAtByPane()).toEqual({ p: null })
    expect(store.unreadPaneSeverities()).toEqual({})
  })

  it('does not advance cache revision from an ack and avoids ack-before-delta flash', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('10', [pane('p', '5', '0')]))
    store.addOverlay('read-p', [{ paneId: 'p', throughEventSeq: 5n }])

    store.applyMarkReadResult({
      requestId: 'read-p',
      epoch: 'epoch-a',
      appliedAtRevision: '12',
      results: [{ target: { paneId: 'p' }, status: 'applied' }],
    })
    expect(store.cacheRevision).toBe(10n)
    expect(store.overlays.get('read-p')?.ackedAtRevision).toBe(12n)
    expect(store.unreadAttentionCount()).toBe(0)

    store.applyDelta(state('11', []))
    expect(store.overlays.has('read-p')).toBe(true)
    expect(store.unreadAttentionCount()).toBe(0)

    store.applyDelta(state('12', [pane('p', '5', '5')]))
    expect(store.overlays.has('read-p')).toBe(false)
    expect(store.unreadAttentionCount()).toBe(0)
  })

  it.each(['invalid', 'not_found', 'conflict'] as const)(
    'rolls back a %s target individually',
    (rejectedStatus) => {
      const store = createAttentionStore()
      store.applySnapshot(state('1', [pane('a', '1', '0'), pane('b', '2', '0')]))
      store.addOverlay('mixed', [
        { paneId: 'a', throughEventSeq: 1n },
        { paneId: 'b', throughEventSeq: 2n },
      ])

      store.applyMarkReadResult({
        requestId: 'mixed',
        epoch: 'epoch-a',
        appliedAtRevision: '3',
        results: [
          { target: { paneId: 'a' }, status: 'applied' },
          { target: { paneId: 'b' }, status: rejectedStatus },
        ],
      })

      expect(store.unreadPaneSeverities()).toEqual({ b: 'warning' })
      expect(store.overlays.get('mixed')?.targets).toHaveLength(1)
    }
  )

  it('cancels all overlays on stale_epoch', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('1', [pane('a', '1', '0'), pane('b', '2', '0')]))
    store.addOverlay('one', [{ paneId: 'a', throughEventSeq: 1n }])
    store.addOverlay('two', [{ paneId: 'b', throughEventSeq: 2n }])

    store.applyMarkReadResult({
      requestId: 'one',
      epoch: 'epoch-b',
      appliedAtRevision: null,
      results: [{ target: { paneId: 'a' }, status: 'stale_epoch' }],
    })

    expect(store.overlays.size).toBe(0)
    expect(store.unreadAttentionCount()).toBe(2)
  })

  it('keeps pending masks across unread snapshots and retires them only when proved', () => {
    const store = createAttentionStore()
    store.applySnapshot(state('1', [pane('p', '5', '0')], [{ notifId: 'n', read: false }]))
    store.addOverlay('pending', [{ paneId: 'p', throughEventSeq: 5n }, { notifId: 'n' }])

    store.applySnapshot(state('1', [pane('p', '5', '0')], [{ notifId: 'n', read: false }]))
    expect(store.overlays.get('pending')?.targets).toHaveLength(2)
    expect(store.unreadAttentionCount()).toBe(0)

    store.applySnapshot(state('2', [pane('p', '5', '5')], [{ notifId: 'n', read: true }]))
    expect(store.overlays.has('pending')).toBe(false)
    expect(store.unreadAttentionCount()).toBe(0)
  })

  it('counts unread panes and pane-less notification identities', () => {
    const store = createAttentionStore()
    store.applySnapshot(
      state(
        '1',
        [pane('a', '1', '0'), pane('read', '2', '2')],
        [
          { notifId: 'n1', read: false },
          { notifId: 'n2', read: true },
        ]
      )
    )
    expect(store.unreadAttentionCount()).toBe(2)
  })
})
