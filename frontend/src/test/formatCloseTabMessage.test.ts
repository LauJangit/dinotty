import { describe, it, expect } from 'vitest'
import { formatCloseTabMessage } from '../composables/formatCloseTabMessage'

// Spec: openspec/changes/confirm-before-close-tab/design.md §E9
// The base message (t('confirm.closeTabMessage')) is interpolated manually
// because t() does not support {var} interpolation. English uses "title" and
// Chinese uses 「title」 — different quotation styles per locale.

describe('formatCloseTabMessage', () => {
  const BASE = 'Closing this session will terminate all running processes. Close'

  it('returns base message unchanged when title is empty (en)', () => {
    expect(formatCloseTabMessage(BASE, '', 'en')).toBe(BASE)
  })

  it('returns base message unchanged when title is empty (zh)', () => {
    expect(formatCloseTabMessage(BASE, '', 'zh')).toBe(BASE)
  })

  it('English: wraps title in single quotes with ASCII question mark', () => {
    expect(formatCloseTabMessage(BASE, 'npm install', 'en'))
      .toBe(`${BASE} 'npm install'?`)
  })

  it('Chinese: wraps title in CJK brackets with fullwidth question mark', () => {
    expect(formatCloseTabMessage(BASE, 'npm install', 'zh'))
      .toBe(`${BASE}「npm install」？`)
  })

  it('English: handles CJK characters in title (no special escaping)', () => {
    expect(formatCloseTabMessage(BASE, '服务器', 'en'))
      .toBe(`${BASE} '服务器'?`)
  })

  it('Chinese: handles ASCII characters in title', () => {
    expect(formatCloseTabMessage(BASE, '服务器', 'zh'))
      .toBe(`${BASE}「服务器」？`)
  })

  it('English: handles title containing single quotes', () => {
    expect(formatCloseTabMessage(BASE, "it's running", 'en'))
      .toBe(`${BASE} 'it's running'?`)
  })
})
