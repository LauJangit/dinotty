import { describe, expect, it } from 'vitest'
import { hasAuthToken, markCookieAuthenticated } from '../composables/apiBase'

describe('markCookieAuthenticated', () => {
  it('marks a non-Tauri session as authenticated', () => {
    markCookieAuthenticated()
    expect(hasAuthToken()).toBe(true)
  })
})
