export interface PaneDeltaWire {
  paneId: string
  latestEventSeq: string | null
  readThroughSeq: string | null
  firstUnreadAt: number | null
  severity: string | null
  removed?: true
}

export interface NotifDeltaWire {
  notifId: string
  read: boolean | null
  removed?: true
}

export interface AttentionStateEnvelope {
  epoch: string
  revision: string
  panes: PaneDeltaWire[]
  notifs: NotifDeltaWire[]
}

export type OverlayTarget = { paneId: string; throughEventSeq: bigint } | { notifId: string }

export interface MarkReadResultWire {
  requestId: string
  epoch: string
  appliedAtRevision: string | null
  results: Array<{
    target: { paneId: string } | { notifId: string }
    status: 'applied' | 'stale_epoch' | 'invalid' | 'not_found' | 'conflict'
  }>
}

export interface PaneAttentionState {
  latestEventSeq: bigint
  readThroughSeq: bigint
  firstUnreadAt: number | null
  severity: string | null
}

export interface NotifAttentionState {
  read: boolean
}

export interface AttentionOverlay {
  targets: OverlayTarget[]
  ackedAtRevision: bigint | null
}

function isPaneTarget(target: OverlayTarget): target is Extract<OverlayTarget, { paneId: string }> {
  return 'paneId' in target
}

function sameTarget(left: OverlayTarget, right: { paneId: string } | { notifId: string }): boolean {
  return isPaneTarget(left)
    ? 'paneId' in right && left.paneId === right.paneId
    : 'notifId' in right && left.notifId === right.notifId
}

export function createAttentionStore() {
  const store = {
    epoch: null as string | null,
    cacheRevision: 0n,
    awaitingSnapshot: false,
    panes: new Map<string, PaneAttentionState>(),
    notifs: new Map<string, NotifAttentionState>(),
    overlays: new Map<string, AttentionOverlay>(),

    applyDelta(delta: AttentionStateEnvelope): boolean {
      if (store.awaitingSnapshot) return false
      if (store.epoch !== null && delta.epoch !== store.epoch) {
        store.awaitingSnapshot = true
        return false
      }

      const revision = BigInt(delta.revision)
      if (revision <= store.cacheRevision) return false
      if (store.epoch === null) store.epoch = delta.epoch

      for (const paneDelta of delta.panes) {
        if (paneDelta.removed) {
          store.panes.delete(paneDelta.paneId)
          continue
        }
        const previous = store.panes.get(paneDelta.paneId) ?? {
          latestEventSeq: 0n,
          readThroughSeq: 0n,
          firstUnreadAt: null,
          severity: null,
        }
        store.panes.set(paneDelta.paneId, {
          latestEventSeq:
            paneDelta.latestEventSeq === null
              ? previous.latestEventSeq
              : BigInt(paneDelta.latestEventSeq),
          readThroughSeq:
            paneDelta.readThroughSeq === null
              ? previous.readThroughSeq
              : BigInt(paneDelta.readThroughSeq),
          firstUnreadAt: paneDelta.firstUnreadAt,
          severity: paneDelta.severity,
        })
      }

      for (const notifDelta of delta.notifs) {
        if (notifDelta.removed) {
          store.notifs.delete(notifDelta.notifId)
          continue
        }
        const previous = store.notifs.get(notifDelta.notifId) ?? { read: false }
        store.notifs.set(notifDelta.notifId, {
          read: notifDelta.read === null ? previous.read : notifDelta.read,
        })
      }

      store.cacheRevision = revision
      store.revalidateOverlays()
      return true
    },

    applySnapshot(snapshot: AttentionStateEnvelope): boolean {
      const revision = BigInt(snapshot.revision)
      const epochChanged = store.epoch !== snapshot.epoch
      if (!epochChanged && revision < store.cacheRevision) return false

      if (epochChanged) store.overlays.clear()
      store.epoch = snapshot.epoch
      store.cacheRevision = revision
      store.awaitingSnapshot = false
      store.panes.clear()
      store.notifs.clear()

      for (const pane of snapshot.panes) {
        if (pane.removed) continue
        store.panes.set(pane.paneId, {
          latestEventSeq: BigInt(pane.latestEventSeq ?? '0'),
          readThroughSeq: BigInt(pane.readThroughSeq ?? '0'),
          firstUnreadAt: pane.firstUnreadAt,
          severity: pane.severity,
        })
      }
      for (const notif of snapshot.notifs) {
        if (notif.removed) continue
        store.notifs.set(notif.notifId, { read: notif.read ?? false })
      }

      store.revalidateOverlays()
      return true
    },

    noteResyncRequired(): boolean {
      if (store.awaitingSnapshot) return false
      store.awaitingSnapshot = true
      return false
    },

    addOverlay(requestId: string, targets: OverlayTarget[]): boolean {
      if (targets.length === 0) return false
      store.overlays.set(requestId, { targets: [...targets], ackedAtRevision: null })
      return true
    },

    dropOverlay(requestId: string): boolean {
      return store.overlays.delete(requestId)
    },

    dropOverlayTarget(
      requestId: string,
      target: { paneId: string } | { notifId: string }
    ): boolean {
      const overlay = store.overlays.get(requestId)
      if (!overlay) return false
      const nextTargets = overlay.targets.filter((candidate) => !sameTarget(candidate, target))
      if (nextTargets.length === overlay.targets.length) return false
      if (nextTargets.length === 0) store.overlays.delete(requestId)
      else overlay.targets = nextTargets
      return true
    },

    applyMarkReadResult(result: MarkReadResultWire): boolean {
      if (result.results.some(({ status }) => status === 'stale_epoch')) {
        const changed = store.overlays.size > 0
        store.overlays.clear()
        return changed
      }

      const overlay = store.overlays.get(result.requestId)
      if (!overlay) return false
      let changed = false
      const appliedRevision =
        result.appliedAtRevision === null ? null : BigInt(result.appliedAtRevision)

      for (const targetResult of result.results) {
        if (targetResult.status === 'applied') {
          if (appliedRevision === null || appliedRevision <= store.cacheRevision) {
            changed = store.dropOverlayTarget(result.requestId, targetResult.target) || changed
          } else {
            const current = store.overlays.get(result.requestId)
            if (current) current.ackedAtRevision = appliedRevision
          }
        } else {
          changed = store.dropOverlayTarget(result.requestId, targetResult.target) || changed
        }
      }

      return changed
    },

    unreadPaneSeverities(): Record<string, string> {
      const result: Record<string, string> = {}
      for (const [paneId, pane] of store.panes) {
        if (pane.latestEventSeq <= pane.readThroughSeq) continue
        const masked = [...store.overlays.values()].some((overlay) =>
          overlay.targets.some(
            (target) =>
              isPaneTarget(target) &&
              target.paneId === paneId &&
              target.throughEventSeq >= pane.latestEventSeq
          )
        )
        if (!masked && pane.severity !== null) result[paneId] = pane.severity
      }
      return result
    },

    unreadNotifIds(): string[] {
      const result: string[] = []
      for (const [notifId, notif] of store.notifs) {
        if (notif.read) continue
        const masked = [...store.overlays.values()].some((overlay) =>
          overlay.targets.some((target) => !isPaneTarget(target) && target.notifId === notifId)
        )
        if (!masked) result.push(notifId)
      }
      return result
    },

    unreadAttentionCount(): number {
      return Object.keys(store.unreadPaneSeverities()).length + store.unreadNotifIds().length
    },

    firstUnreadAtByPane(): Record<string, number | null> {
      const result: Record<string, number | null> = {}
      for (const [paneId, pane] of store.panes) result[paneId] = pane.firstUnreadAt
      return result
    },

    revalidateOverlays(): void {
      for (const [requestId, overlay] of store.overlays) {
        if (overlay.ackedAtRevision !== null && overlay.ackedAtRevision <= store.cacheRevision) {
          store.overlays.delete(requestId)
          continue
        }

        overlay.targets = overlay.targets.filter((target) => {
          if (isPaneTarget(target)) {
            const pane = store.panes.get(target.paneId)
            return !pane || pane.readThroughSeq < target.throughEventSeq
          }
          return store.notifs.get(target.notifId)?.read !== true
        })
        if (overlay.targets.length === 0) store.overlays.delete(requestId)
      }
    },
  }

  return store
}

export type AttentionStore = ReturnType<typeof createAttentionStore>
