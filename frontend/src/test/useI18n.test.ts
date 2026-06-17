import { describe, it, expect, beforeEach } from 'vitest'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'

// Behavioral tests for the new confirm-before-close-tab i18n strings.
// These keys are added by Task 3 in openspec change `confirm-before-close-tab`.
// Spec: openspec/changes/confirm-before-close-tab/specs/tab-close-confirmation/spec.md

// Required keys: 3 settings.* keys (General tab toggle row) + 4 confirm.* keys (modal)
const EN_KEYS = [
  'settings.confirmBeforeCloseTab',
  'settings.confirmBeforeCloseTabHint',
  'settings.behavior',
  'confirm.closeTabTitle',
  'confirm.closeTabMessage',
  'confirm.closeTabConfirm',
  'confirm.closeTabCancel',
] as const

describe('useI18n - confirm-before-close-tab strings', () => {
  describe('English locale', () => {
    beforeEach(() => {
      // Force English locale for these tests
      settings.locale = 'en'
    })

    it.each(EN_KEYS)('t(%s) returns a non-empty string (key exists in messages.en)', (key) => {
      const { t } = useI18n()
      const value = t(key)
      // If key is missing, t() returns the key itself. We assert it's different
      // from the key AND is a non-empty trimmed string.
      expect(value).not.toBe(key)
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  })

  describe('Chinese locale', () => {
    beforeEach(() => {
      settings.locale = 'zh'
    })

    it.each(EN_KEYS)('t(%s) returns a non-empty string (key exists in messages.zh)', (key) => {
      const { t } = useI18n()
      const value = t(key)
      expect(value).not.toBe(key)
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  })

  describe('parity', () => {
    it('en and zh both define the same 7 new keys (no missing translation)', async () => {
      // Dynamic import to peek at the messages table via the actual `t` behavior
      // across both locales for the same key set.
      const enResults: Record<string, string> = {}
      const zhResults: Record<string, string> = {}
      // en pass
      settings.locale = 'en'
      const enT = useI18n().t
      for (const k of EN_KEYS) enResults[k] = enT(k)
      // zh pass
      settings.locale = 'zh'
      const zhT = useI18n().t
      for (const k of EN_KEYS) zhResults[k] = zhT(k)

      for (const k of EN_KEYS) {
        // In both locales, t() must NOT fall back to the key itself
        expect(enResults[k], `en missing translation for ${k}`).not.toBe(k)
        expect(zhResults[k], `zh missing translation for ${k}`).not.toBe(k)
      }
    })

    it('en and zh values differ (sanity: not the same hard-coded string)', () => {
      // Each `useI18n()` instance creates a `computed` that snapshots the
      // current `settings.locale` on first access. Set locale first, then
      // grab a fresh `t` for that locale, then switch.
      settings.locale = 'en'
      const enConfirmTitle = useI18n().t('confirm.closeTabTitle')

      settings.locale = 'zh'
      const zhConfirmTitle = useI18n().t('confirm.closeTabTitle')

      // At least the values for the new keys should not be identical
      // between locales — Chinese strings should differ from English.
      expect(enConfirmTitle).not.toBe(zhConfirmTitle)
      expect(enConfirmTitle.trim().length).toBeGreaterThan(0)
      expect(zhConfirmTitle.trim().length).toBeGreaterThan(0)
    })
  })
})
