import { describe, it, expect } from 'vitest'
import { formatCloseTabMessage } from '../composables/formatCloseTabMessage'

// Spec: openspec/changes/confirm-before-close-tab/design.md §E9
// The base message (t('confirm.closeTabMessage')) is interpolated manually
// because t() does not support {var} interpolation. English uses "title" and
// Chinese uses 「title」 — different quotation styles per locale.

describe('formatCloseTabMessage', () => {
  const BASE = 'Closing this session will terminate a possibly running AI agent. Proceed to'

  it('returns base message unchanged when title is empty (en)', () => {
    expect(formatCloseTabMessage(BASE, '', 'en')).toBe(BASE)
  })

  it('returns base message unchanged when title is empty (zh)', () => {
    expect(formatCloseTabMessage(BASE, '', 'zh')).toBe(BASE)
  })

  it('English: wraps title in double quotes with ASCII question mark', () => {
    expect(formatCloseTabMessage(BASE, 'npm install', 'en'))
      .toBe(`${BASE} "npm install"?`)
  })

  it('Chinese: wraps title in CJK brackets with fullwidth question mark', () => {
    expect(formatCloseTabMessage(BASE, 'npm install', 'zh'))
      .toBe(`${BASE}「npm install」？`)
  })

  it('English: handles CJK characters in title (no special escaping)', () => {
    // The composable does not sanitize; it just concatenates.
    expect(formatCloseTabMessage(BASE, '服务器', 'en'))
      .toBe(`${BASE} "服务器"?`)
  })

  it('Chinese: handles ASCII characters in title', () => {
    expect(formatCloseTabMessage(BASE, '服务器', 'zh'))
      .toBe(`${BASE}「服务器」？`)
  })
})
