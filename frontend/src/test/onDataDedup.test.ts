import { describe, it, expect } from 'vitest'
import { isDuplicateOnData, DEDUP_WINDOW_MS } from '../composables/useTerminal'

// Root cause: 5ms dedup window was too wide — xterm.js macOS modifier
// sequences (Shift+punct) span > 5ms, so the second valid onData was
// being swallowed by the dedup check.

describe('onData dedup helper (useTerminal)', () => {
  it('exposes a small window (<= 2ms)', () => {
    expect(DEDUP_WINDOW_MS).toBeLessThanOrEqual(2)
  })

  it('drops a WKWebView multi-focus replay within the window', () => {
    expect(isDuplicateOnData('?', '?', 1000, 1001)).toBe(true)
  })

  it('allows a real next keystroke after the window expires', () => {
    expect(isDuplicateOnData('?', '?', 1000, 1010)).toBe(false)
  })

  it('allows different data even within the window', () => {
    expect(isDuplicateOnData('!', '?', 1000, 1001)).toBe(false)
  })

  it('regression: Shift+punct modifier sequence is NOT swallowed', () => {
    // First event always passes through (prev === '')
    expect(isDuplicateOnData('', '', 1000, 1001)).toBe(false)
    // Different data (modifier prefix vs real char) is never a duplicate
    expect(isDuplicateOnData('?', '', 1000, 1003)).toBe(false)
  })
})
