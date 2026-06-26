import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCompositionGuard } from '../composables/useTerminal'

describe('compositionGuard (useTerminal)', () => {
  let sendDataMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    sendDataMock = vi.fn()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeCompositionEndEvent(data: string): CompositionEvent {
    return { data } as CompositionEvent
  }

  // ── Shift+punct (e.g. Shift+; → ：) ──

  it('Shift+punct: sends committed text directly via sendData', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent('：'))

    expect(sendDataMock).toHaveBeenCalledWith('：')

    cg.cleanup()
  })

  it('Shift+punct: guard blocks xterm.js duplicate during 50ms window', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent('：'))
    sendDataMock.mockClear()

    // xterm.js sends its duplicate via setTimeout(0) — guard blocks it
    expect(cg.guard()).toBe(false)

    // After 50ms window — guard allows normal input
    vi.advanceTimersByTime(51)
    expect(cg.guard()).toBe(true)

    cg.cleanup()
  })

  it('Shift+punct: second press also works', () => {
    const cg = createCompositionGuard(sendDataMock)

    // First press
    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent('：'))

    // Wait for 50ms window to expire
    vi.advanceTimersByTime(51)

    // Second press
    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent('：'))

    expect(sendDataMock).toHaveBeenCalledTimes(2)
    expect(sendDataMock).toHaveBeenNthCalledWith(1, '：')
    expect(sendDataMock).toHaveBeenNthCalledWith(2, '：')

    cg.cleanup()
  })

  // ── Real IME composition (e.g. pinyin "nihao" → 你好) ──

  it('Real IME: guard blocks during active composition', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()

    expect(cg.guard()).toBe(false)

    cg.cleanup()
  })

  it('Real IME: guard blocks for 50ms after compositionend', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent('你好'))

    // Committed text sent directly
    expect(sendDataMock).toHaveBeenCalledWith('你好')

    // Guard blocks xterm.js duplicate
    expect(cg.guard()).toBe(false)

    // After 50ms — normal input resumes
    vi.advanceTimersByTime(51)
    expect(cg.guard()).toBe(true)

    cg.cleanup()
  })

  it('Real IME: guard blocks during 50ms window then resumes', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent('你好'))
    sendDataMock.mockClear()

    // During 50ms window — blocked
    expect(cg.guard()).toBe(false)
    expect(cg.guard()).toBe(false)

    // After 50ms — resumes
    vi.advanceTimersByTime(51)
    expect(cg.guard()).toBe(true)

    cg.cleanup()
  })

  // ── Normal typing (no composition) ──

  it('Normal typing: guard allows when no composition is active', () => {
    const cg = createCompositionGuard(sendDataMock)

    expect(cg.guard()).toBe(true)
    expect(cg.guard()).toBe(true)

    cg.cleanup()
  })

  // ── Edge cases ──

  it('Safety timer: resets after 1000ms if compositionend never fires', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()

    // During composition — blocked
    expect(cg.guard()).toBe(false)

    // Still blocked at 900ms
    vi.advanceTimersByTime(900)
    expect(cg.guard()).toBe(false)

    // After 1000ms safety timer — resets
    vi.advanceTimersByTime(110)
    expect(cg.guard()).toBe(true)

    cg.cleanup()
  })

  it('New compositionstart clears previous safety timer', () => {
    const cg = createCompositionGuard(sendDataMock)

    // First composition — starts safety timer
    cg.onCompositionStart()

    // 200ms later, new composition starts (e.g. user restarted IME)
    vi.advanceTimersByTime(200)
    cg.onCompositionStart() // should clear old timer

    // compositionend fires with committed text
    cg.onCompositionEnd(makeCompositionEndEvent('你好'))

    expect(sendDataMock).toHaveBeenCalledWith('你好')

    cg.cleanup()
  })

  it('Cancelled composition: allows normal input after 50ms', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()
    // User cancels with Escape — no committed text
    cg.onCompositionEnd(makeCompositionEndEvent(''))

    expect(sendDataMock).not.toHaveBeenCalled()

    // 50ms window — blocked
    expect(cg.guard()).toBe(false)

    // After 50ms — resumes
    vi.advanceTimersByTime(51)
    expect(cg.guard()).toBe(true)

    cg.cleanup()
  })

  it('cleanup: clears all timers', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()

    cg.cleanup()

    // After cleanup, guard allows input
    expect(cg.guard()).toBe(true)
  })

  it('compositionend with no data does not call sendData', () => {
    const cg = createCompositionGuard(sendDataMock)

    cg.onCompositionStart()
    cg.onCompositionEnd(makeCompositionEndEvent(''))

    expect(sendDataMock).not.toHaveBeenCalled()

    cg.cleanup()
  })
})
