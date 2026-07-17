// Repro test for P4: 2ms isDuplicateOnData drops legitimate fast repeats.
//
// Scenario from investigate doc: typing `3000000` fast lands as `30` because
// consecutive '0's within 2ms are dropped by the WKWebView-replay dedup.
// The dedup is data-blind: it cannot distinguish WKWebView multi-focus replay
// from a real user holding/repeating a key.

import { describe, it, expect } from 'vitest'
import { isDuplicateOnData, DEDUP_WINDOW_MS } from '../composables/useTerminal'

describe('P4 repro: 2ms dedup drops fast identical repeats', () => {
  it('DEDUP_WINDOW_MS is 2 (the over-eager value)', () => {
    expect(DEDUP_WINDOW_MS).toBe(2)
  })

  it('drops consecutive identical chars within 2ms (the bug)', () => {
    // Same char, 1ms apart -> dropped (legitimate repeat treated as replay)
    expect(isDuplicateOnData('0', '0', 1000, 1001)).toBe(true)
    expect(isDuplicateOnData('0', '0', 1000, 1001.5)).toBe(true)
  })

  it('keeps consecutive identical chars >= 2ms apart', () => {
    expect(isDuplicateOnData('0', '0', 1000, 1002)).toBe(false)
    expect(isDuplicateOnData('0', '0', 1000, 1003)).toBe(false)
  })

  it('end-to-end: typing `3000000` at 1ms-per-key drops half the zeros', () => {
    // Simulate fast keyboard auto-repeat at 1ms intervals.
    // The dedup drops every other '0' because gap (1ms) < DEDUP_WINDOW_MS (2),
    // but keeps every 2ms '0' because gap == 2ms is NOT < 2.
    const keys = ['3', '0', '0', '0', '0', '0', '0']
    const start = 1000
    const intervalMs = 1
    const emitted: string[] = []
    let prev = ''
    let prevAt = 0
    for (let i = 0; i < keys.length; i++) {
      const data = keys[i]
      const now = start + i * intervalMs
      if (!isDuplicateOnData(data, prev, prevAt, now)) {
        emitted.push(data)
        prev = data
        prevAt = now
      }
    }
    // BUG: 3 of 6 zeros dropped at 1ms interval (alternating drop pattern
    // because gap==2ms is NOT <2ms, so every other '0' survives).
    expect(emitted.join('')).toBe('3000')
  })

  it('end-to-end: sub-millisecond paste fires within one JS tick -> `3000000` -> `30`', () => {
    // The investigate doc's `3000000` -> `30` scenario: paste/IME-buffered
    // input is flushed as multiple onData calls within a single synchronous
    // tick, so performance.now() returns nearly identical values (sub-ms).
    // Every '0' after the first falls within 2ms of the previous '0' and is
    // dropped.
    const keys = ['3', '0', '0', '0', '0', '0', '0']
    const start = 1000
    const intervalMs = 0.1 // sub-millisecond (synchronous flush)
    const emitted: string[] = []
    let prev = ''
    let prevAt = 0
    for (let i = 0; i < keys.length; i++) {
      const data = keys[i]
      const now = start + i * intervalMs
      if (!isDuplicateOnData(data, prev, prevAt, now)) {
        emitted.push(data)
        prev = data
        prevAt = now
      }
    }
    // BUG: matches investigate doc exactly - 5 of 6 zeros dropped.
    expect(emitted.join('')).toBe('30')
  })

  it('control: typing `3000000` at 3ms-per-key keeps all 7 chars', () => {
    const keys = ['3', '0', '0', '0', '0', '0', '0']
    const start = 1000
    const intervalMs = 3 // slightly slower typing escapes dedup
    const emitted: string[] = []
    let prev = ''
    let prevAt = 0
    for (let i = 0; i < keys.length; i++) {
      const data = keys[i]
      const now = start + i * intervalMs
      if (!isDuplicateOnData(data, prev, prevAt, now)) {
        emitted.push(data)
        prev = data
        prevAt = now
      }
    }
    expect(emitted.join('')).toBe('3000000')
  })

  it('end-to-end: key-repeat of arrow keys (Escape sequences) at sub-ms is also dropped', () => {
    // Arrow keys produce escape sequences like \x1b[A. Synchronous flush
    // (e.g. held key during heavy main-thread work) produces sub-ms gaps.
    const arrow = '\x1b[A'
    const emitted: string[] = []
    let prev = ''
    let prevAt = 0
    for (let i = 0; i < 5; i++) {
      const now = 1000 + i * 0.1
      if (!isDuplicateOnData(arrow, prev, prevAt, now)) {
        emitted.push(arrow)
        prev = arrow
        prevAt = now
      }
    }
    // BUG: 4 of 5 arrow repeats dropped.
    expect(emitted.length).toBe(1)
  })

  it('paste of repeated chars via keystroke-style input is also dropped', () => {
    // Some paste paths emit char-by-char input events rather than a single
    // bulk onData. Pasting `aaaa` would emit 4 'a' onData events; if they
    // land within 2ms (e.g. IME-assisted paste), only 1 survives.
    const emitted: string[] = []
    let prev = ''
    let prevAt = 0
    for (let i = 0; i < 4; i++) {
      const now = 1000 + i * 0.3
      if (!isDuplicateOnData('a', prev, prevAt, now)) {
        emitted.push('a')
        prev = 'a'
        prevAt = now
      }
    }
    expect(emitted.length).toBe(1) // 3 of 4 'a's dropped
  })
})
