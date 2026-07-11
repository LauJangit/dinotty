import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub out the side-effecting module APIs that GeneralTab touches in
// onMounted. We don't want real network calls, QR code rendering, or
// clipboard IO in unit tests.
vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ lan_ip: '127.0.0.1', port: 7681 }),
  })),
  getAuthToken: () => '',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  hasAuthToken: () => false,
}))

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn() },
  toCanvas: vi.fn(),
}))

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
}))

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import GeneralTab from '../components/settings/GeneralTab.vue'
import { settings } from '../composables/useSettings'

// Spec: openspec/changes/confirm-before-close-tab/spec.md
//   "### Requirement: Setting UI In General Settings"
// GeneralTab must expose a toggle bound to settings.confirm_before_close_tab.

describe('GeneralTab - confirm-before-close-tab toggle', () => {
  beforeEach(() => {
    // Reset the shared reactive settings to the documented default.
    settings.confirm_before_close_tab = true
  })

  it('renders a toggle input bound to settings.confirm_before_close_tab', () => {
    const wrapper = mount(GeneralTab)
    const input = wrapper.find<HTMLInputElement>(
      'input[type="checkbox"][data-setting="confirm-before-close-tab"]'
    )
    expect(input.exists()).toBe(true)
    // Initial value mirrors reactive default (true).
    expect(input.element.checked).toBe(true)
  })

  it('renders the behavior section header with a settings.behavior i18n key', () => {
    const wrapper = mount(GeneralTab)
    // The new section is appended after the virtualKeyboard section.
    // We assert the section is present in the DOM regardless of locale.
    const sections = wrapper.findAll('section.settings-section')
    const lastSection = sections[sections.length - 1]
    expect(lastSection.exists()).toBe(true)
    // The header h3 inside the new section should be a non-empty text.
    const header = lastSection.find('h3')
    expect(header.exists()).toBe(true)
    // The text should be one of the known translations (either zh or en),
    // not the raw key.
    const headerText = header.text().trim()
    expect(headerText).not.toBe('settings.behavior')
    expect(headerText.length).toBeGreaterThan(0)
  })

  it('renders a hint paragraph for the new toggle', () => {
    const wrapper = mount(GeneralTab)
    const hint = wrapper.find('p.settings-hint[data-hint="confirm-before-close-tab"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text().trim().length).toBeGreaterThan(0)
  })

  it('toggling the checkbox updates settings.confirm_before_close_tab', async () => {
    const wrapper = mount(GeneralTab)
    const input = wrapper.find<HTMLInputElement>(
      'input[type="checkbox"][data-setting="confirm-before-close-tab"]'
    )
    expect(input.exists()).toBe(true)

    // Sanity: starts at the default true.
    expect(settings.confirm_before_close_tab).toBe(true)

    // Flip it via v-model.
    await input.setValue(false)
    await nextTick()

    expect(settings.confirm_before_close_tab).toBe(false)
  })

  it('reflects an externally toggled settings.confirm_before_close_tab back into the checkbox', async () => {
    const wrapper = mount(GeneralTab)
    const input = wrapper.find<HTMLInputElement>(
      'input[type="checkbox"][data-setting="confirm-before-close-tab"]'
    )
    expect(input.exists()).toBe(true)

    settings.confirm_before_close_tab = false
    await nextTick()
    expect(input.element.checked).toBe(false)

    settings.confirm_before_close_tab = true
    await nextTick()
    expect(input.element.checked).toBe(true)
  })
})
