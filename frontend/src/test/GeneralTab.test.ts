import { describe, it, expect, beforeEach, vi } from 'vitest'

const generalMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  uploadStatus: 200,
  defaultDir: '/tmp/dinotty',
}))

// Stub out the side-effecting module APIs that GeneralTab touches in
// onMounted. We don't want real network calls, QR code rendering, or
// clipboard IO in unit tests.
vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: generalMocks.authFetch,
  getAuthToken: () => '',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  hasAuthToken: () => false,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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
    settings.upload_dir = ''
    generalMocks.uploadStatus = 200
    generalMocks.defaultDir = '/tmp/dinotty'
    generalMocks.authFetch.mockReset()
    generalMocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/uploads/default-dir') {
        return response({ default_dir: generalMocks.defaultDir })
      }
      if (url === '/api/uploads') {
        return response(
          { saved: [], managed: true, foreign: false, empty: true },
          generalMocks.uploadStatus
        )
      }
      if (url === '/api/info') return response({ lan_ip: '127.0.0.1', port: 7681 })
      if (url === '/api/qr-code') return response({ code: '' })
      if (url === '/api/settings' && init?.method === 'PUT') return response({})
      return response({})
    })
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

  it('shows an inline upload_dir error when status validation returns 400', async () => {
    const wrapper = mount(GeneralTab)
    await flush()
    generalMocks.uploadStatus = 400

    const input = wrapper.find<HTMLInputElement>('[data-testid="upload-dir-input"]')
    await input.setValue('/missing-dir')
    await input.trigger('change')
    await flush()

    const error = wrapper.find('[data-testid="upload-dir-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text().trim().length).toBeGreaterThan(0)
    const hintTexts = wrapper.findAll('p.settings-hint').map((hint) => hint.text())
    expect(
      hintTexts.some(
        (text) =>
          text.includes('Upload directory status unavailable') ||
          text.includes('无法获取上传目录状态')
      )
    ).toBe(false)
  })

  it('keeps the neutral upload status hint when status validation returns 500', async () => {
    const wrapper = mount(GeneralTab)
    await flush()
    generalMocks.uploadStatus = 500

    const input = wrapper.find<HTMLInputElement>('[data-testid="upload-dir-input"]')
    await input.setValue('/server-error-dir')
    await input.trigger('change')
    await flush()

    expect(wrapper.find('[data-testid="upload-dir-error"]').exists()).toBe(false)
    const hintTexts = wrapper.findAll('p.settings-hint').map((hint) => hint.text())
    expect(
      hintTexts.some(
        (text) =>
          text.includes('Upload directory status unavailable') ||
          text.includes('无法获取上传目录状态')
      )
    ).toBe(true)
  })

  it('clears a stale upload_dir error when an upload status event succeeds', async () => {
    const wrapper = mount(GeneralTab)
    await flush()
    generalMocks.uploadStatus = 400

    const input = wrapper.find<HTMLInputElement>('[data-testid="upload-dir-input"]')
    await input.setValue('/missing-dir')
    await input.trigger('change')
    await flush()
    expect(wrapper.find('[data-testid="upload-dir-error"]').exists()).toBe(true)

    window.dispatchEvent(
      new CustomEvent('dinotty-upload-status', {
        detail: { managed: true, foreign: false, empty: true },
      })
    )
    await flush()

    expect(wrapper.find('[data-testid="upload-dir-error"]').exists()).toBe(false)
  })

  it('restores the backend default upload directory into the input', async () => {
    generalMocks.defaultDir = '/var/tmp/dinotty'
    const wrapper = mount(GeneralTab)
    await flush()

    await wrapper.find('[data-testid="restore-upload-default"]').trigger('click')
    await flush()

    expect(generalMocks.authFetch).toHaveBeenCalledWith('/api/uploads/default-dir', {
      method: 'GET',
    })
    expect(settings.upload_dir).toBe('/var/tmp/dinotty')
    expect(wrapper.find<HTMLInputElement>('[data-testid="upload-dir-input"]').element.value).toBe(
      '/var/tmp/dinotty'
    )
  })
})

function response(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}
