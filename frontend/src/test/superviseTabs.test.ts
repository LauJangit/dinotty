import { describe, expect, it } from 'vitest'
import { pickSupervisedTab, type TabCandidate } from '../utils/superviseTabs'

function tabs(...items: Array<[string, number | null]>): TabCandidate[] {
  return items.map(([id, reminderAt]) => ({ id, reminderAt }))
}

function pick(
  candidates: readonly TabCandidate[],
  currentTabId: string | null,
  pendingTabIds: readonly string[] = []
) {
  return pickSupervisedTab({
    tabs: candidates,
    currentTabId,
    pendingTabIds: new Set(pendingTabIds),
  })
}

describe('pickSupervisedTab', () => {
  it('picks the oldest reminder', () => {
    expect(pick(tabs(['a', null], ['b', 20], ['c', 10]), 'a')).toEqual({
      targetTabId: 'c',
      reason: 'reminder',
    })
  })

  it('excludes a reminder on the current tab', () => {
    expect(pick(tabs(['a', 1], ['b', 20], ['c', 10]), 'a').targetTabId).toBe('c')
  })

  it('excludes pending tabs from the reminder branch', () => {
    expect(pick(tabs(['a', null], ['b', 1], ['c', 2]), 'a', ['b'])).toEqual({
      targetTabId: 'c',
      reason: 'reminder',
    })
  })

  it('uses input order to break equal reminder timestamps', () => {
    expect(pick(tabs(['a', null], ['b', 10], ['c', 10]), 'a').targetTabId).toBe('b')
  })

  it('steps to the tab on the right of current when no reminder exists', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a')).toEqual({
      targetTabId: 'b',
      reason: 'sweep',
    })
  })

  it('steps over already-read tabs without a visited-skip', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a').targetTabId).toBe('b')
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'b').targetTabId).toBe('c')
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'c').targetTabId).toBe('a')
  })

  it('wraps at the end of the list back to the first tab', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'c').targetTabId).toBe('a')
  })

  it('skips pending tabs during the positional step', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a', ['b'])).toEqual({
      targetTabId: 'c',
      reason: 'sweep',
    })
  })

  it('returns null when the only tab is current', () => {
    expect(pick(tabs(['a', null]), 'a')).toEqual({
      targetTabId: null,
      reason: null,
    })
  })

  it('returns null when every other tab is pending', () => {
    expect(pick(tabs(['a', null], ['b', null], ['c', null]), 'a', ['b', 'c'])).toEqual({
      targetTabId: null,
      reason: null,
    })
  })

  it('returns null for an empty tab list', () => {
    expect(pick([], null)).toEqual({
      targetTabId: null,
      reason: null,
    })
  })

  it('starts from index zero when the current id was removed', () => {
    expect(pick(tabs(['a', null], ['b', null]), 'removed')).toEqual({
      targetTabId: 'a',
      reason: 'sweep',
    })
  })

  it('handles duplicate ids deterministically using the first occurrence', () => {
    expect(pick(tabs(['a', null], ['b', 20], ['b', 1], ['c', 10]), 'a').targetTabId).toBe('c')
  })

  it('never mutates the pending input set', () => {
    const pendingTabIds = new Set(['b'])
    pickSupervisedTab({
      tabs: tabs(['a', null], ['b', null]),
      currentTabId: 'a',
      pendingTabIds,
    })
    expect(pendingTabIds).toEqual(new Set(['b']))
  })
})
