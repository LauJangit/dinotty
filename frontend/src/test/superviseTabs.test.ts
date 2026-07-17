import { describe, expect, it } from 'vitest'
import { pickSupervisedTab, type TabCandidate } from '../utils/superviseTabs'

function tabs(...items: Array<[string, number | null]>): TabCandidate[] {
  return items.map(([id, reminderAt]) => ({ id, reminderAt }))
}

function pick(
  candidates: readonly TabCandidate[],
  currentTabId: string | null,
  visitedTabIds: readonly string[] = [],
  pendingTabIds: readonly string[] = []
) {
  return pickSupervisedTab({
    tabs: candidates,
    currentTabId,
    visitedTabIds: new Set(visitedTabIds),
    pendingTabIds: new Set(pendingTabIds),
  })
}

describe('pickSupervisedTab', () => {
  it('returns null for an empty tab list', () => {
    expect(pick([], null)).toEqual({
      targetTabId: null,
      nextVisitedTabIds: new Set(),
      reason: null,
    })
  })

  it('returns null when the only tab is current', () => {
    expect(pick(tabs(['a', null]), 'a')).toEqual({
      targetTabId: null,
      nextVisitedTabIds: new Set(['a']),
      reason: null,
    })
  })

  it('always picks the non-current tab when there are two tabs', () => {
    expect(pick(tabs(['a', null], ['b', null]), 'a', ['a', 'b']).targetTabId).toBe('b')
    expect(pick(tabs(['a', null], ['b', null]), 'b', ['a', 'b']).targetTabId).toBe('a')
  })

  it('picks the oldest reminder', () => {
    expect(pick(tabs(['a', null], ['b', 20], ['c', 10]), 'a')).toMatchObject({
      targetTabId: 'c',
      reason: 'reminder',
    })
  })

  it('excludes a reminder on the current tab', () => {
    expect(pick(tabs(['a', 1], ['b', 20], ['c', 10]), 'a').targetTabId).toBe('c')
  })

  it('falls back to the sweep when only the current tab has a reminder', () => {
    expect(pick(tabs(['a', 1], ['b', null], ['c', null]), 'a')).toMatchObject({
      targetTabId: 'b',
      reason: 'sweep',
    })
  })

  it('uses input order to break equal reminder timestamps', () => {
    expect(pick(tabs(['a', null], ['b', 10], ['c', 10]), 'a').targetTabId).toBe('b')
  })

  it('starts the sweep after current and wraps', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'b', ['b']).targetTabId).toBe('c')
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'c', ['c']).targetTabId).toBe('a')
  })

  it('skips visited tabs during the sweep', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a', ['a', 'b']).targetTabId).toBe('c')
  })

  it('resets an exhausted sweep without picking current', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'b', ['a', 'b', 'c'])).toEqual({
      targetTabId: 'c',
      nextVisitedTabIds: new Set(['b']),
      reason: 'sweep',
    })
  })

  it('drops stale visited ids', () => {
    const result = pick(tabs(['a', null], ['b', null]), 'a', ['a', 'gone'])

    expect(result.nextVisitedTabIds).toEqual(new Set(['a']))
  })

  it('treats a newly added tab as unvisited and eligible', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a', ['a', 'b']).targetTabId).toBe('c')
  })

  it('starts from index zero when the current id was removed', () => {
    expect(pick(tabs(['a', null], ['b', null]), 'removed', ['removed'])).toEqual({
      targetTabId: 'a',
      nextVisitedTabIds: new Set(),
      reason: 'sweep',
    })
  })

  it('handles duplicate ids deterministically using the first occurrence', () => {
    expect(pick(tabs(['a', null], ['b', 20], ['b', 1], ['c', 10]), 'a').targetTabId).toBe('c')
  })

  it('does not add a reminder target to confirmed visits', () => {
    const result = pick(tabs(['a', null], ['b', 1]), 'a')

    expect(result.targetTabId).toBe('b')
    expect(result.nextVisitedTabIds.has('b')).toBe(false)
  })

  it('does not add a sweep target to confirmed visits', () => {
    const result = pick(tabs(['a', null], ['b', null]), 'a')

    expect(result.targetTabId).toBe('b')
    expect(result.nextVisitedTabIds.has('b')).toBe(false)
  })

  it('excludes pending tabs from the reminder branch', () => {
    expect(pick(tabs(['a', null], ['b', 1], ['c', 2]), 'a', [], ['b'])).toMatchObject({
      targetTabId: 'c',
      reason: 'reminder',
    })
  })

  it('excludes pending tabs from the sweep branch', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a', [], ['b'])).toMatchObject({
      targetTabId: 'c',
      reason: 'sweep',
    })
  })

  it('does not reset when every remaining tab is pending', () => {
    expect(
      pick(tabs(['a', null], ['b', null], ['c', null]), 'a', ['a', 'b', 'c'], ['b', 'c'])
    ).toEqual({
      targetTabId: null,
      nextVisitedTabIds: new Set(['a', 'b', 'c']),
      reason: null,
    })
  })

  it('does not reset a mixed round with an unvisited pending tab', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a', ['a', 'b'], ['c'])).toEqual({
      targetTabId: null,
      nextVisitedTabIds: new Set(['a', 'b']),
      reason: null,
    })
  })

  it('never mutates either input set', () => {
    const visitedTabIds = new Set(['a', 'gone'])
    const pendingTabIds = new Set(['b'])
    const result = pickSupervisedTab({
      tabs: tabs(['a', null], ['b', null]),
      currentTabId: 'a',
      visitedTabIds,
      pendingTabIds,
    })

    expect(visitedTabIds).toEqual(new Set(['a', 'gone']))
    expect(pendingTabIds).toEqual(new Set(['b']))
    expect(result.nextVisitedTabIds).not.toBe(visitedTabIds)
  })
})
