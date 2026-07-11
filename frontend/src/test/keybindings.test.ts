import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KeyboardTab from '../components/settings/KeyboardTab.vue'
import { settings } from '../composables/useSettings'
import { handleTerminalShortcutKeydown } from '../composables/useTerminal'
import {
  keyBindingDefs,
  keyEventMatchesBinding,
  useKeybindings,
} from '../composables/useKeybindings'

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  getApiBase: async () => 'http://127.0.0.1:7681',
  hasAuthToken: () => false,
  wsUrlWithToken: (url: string) => url,
}))

const APP_DEFAULTS = [
  ['togglePalette', 'k', false, false],
  ['openBookmarks', 'b', true, false],
  ['newTab', 't', false, false],
  ['closeTab', 'w', false, false],
  ['splitHorizontal', 'd', false, false],
  ['splitVertical', 'd', true, false],
  ['toggleBroadcast', 'i', true, false],
  ['toggleZoom', 'Enter', true, false],
  ['equalizePanes', '=', false, false],
  ['focusNextPane', ']', false, false],
  ['focusPrevPane', '[', false, false],
  ['searchTerminal', 'f', false, false],
  ['switchTab', '1', false, true],
  ['missionControl', 'm', true, false],
  ['sshConnect', 't', true, false],
  ['fontSizeUp', '=', true, false],
  ['fontSizeDown', '-', false, false],
  ['fontSizeReset', '0', false, false],
] as const

function resetKeybindings() {
  settings.keybindings = {}
  settings.locale = 'en'
}

function keyEvent(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

async function recordKey(id: string, event: KeyboardEvent) {
  const wrapper = mount(KeyboardTab)
  await wrapper.find(`[data-kb-id="${id}"] [data-kb-action="record"]`).trigger('click')
  await nextTick()
  window.dispatchEvent(event)
  await nextTick()
  return wrapper
}

describe('unified keybindings', () => {
  beforeEach(() => {
    resetKeybindings()
  })

  it('keeps the 18 app defaults and persisted shape unchanged', () => {
    const appDefs = keyBindingDefs.filter((def) => (def.kind ?? 'app') === 'app')

    expect(appDefs).toHaveLength(18)
    expect(
      appDefs.map((def) => [
        def.id,
        def.defaultBinding.key,
        def.defaultBinding.shift,
        def.readonly === true,
      ])
    ).toEqual(APP_DEFAULTS)
    expect(appDefs.every((def) => def.sequence === undefined)).toBe(true)
    expect(appDefs.every((def) => Object.keys(def.defaultBinding).join(',') === 'key,shift')).toBe(
      true
    )
  })

  it('formats app bindings exactly as before and terminal bindings with literal modifiers', () => {
    const { formatBinding } = useKeybindings()

    expect(formatBinding({ key: 'b', shift: true })).toEqual(['⌘', '⇧', 'B'])
    expect(formatBinding({ key: 'enter', shift: true, meta: false }, 'terminal')).toEqual([
      '⇧',
      '⏎',
    ])
    expect(formatBinding({ key: 'arrowleft', shift: false, meta: true }, 'terminal')).toEqual([
      '⌘',
      '←',
    ])
    expect(formatBinding({ key: 'x', shift: true, ctrl: true, alt: true }, 'terminal')).toEqual([
      '⌃',
      '⌥',
      '⇧',
      'X',
    ])
  })

  it('sends the four terminal default byte sequences', () => {
    const cases = [
      [keyEvent('Enter', { shiftKey: true }), '\x1b\r'],
      [keyEvent('ArrowLeft', { metaKey: true }), '\x01'],
      [keyEvent('ArrowRight', { metaKey: true }), '\x05'],
      [keyEvent('Backspace', { metaKey: true }), '\x15'],
    ] as const

    for (const [event, sequence] of cases) {
      const sendData = vi.fn()
      const stopPropagation = vi.spyOn(event, 'stopPropagation')

      expect(handleTerminalShortcutKeydown(event, sendData)).toBe(true)
      expect(sendData).toHaveBeenCalledWith(sequence)
      expect(event.defaultPrevented).toBe(true)
      expect(stopPropagation).toHaveBeenCalled()
    }
  })

  it('prefers trailing path deletion for terminal delete-to-line-start', () => {
    const pathEvent = keyEvent('Backspace', { metaKey: true })
    const pathSendData = vi.fn()

    expect(
      handleTerminalShortcutKeydown(pathEvent, pathSendData, false, () => 'ls /Users/a/b')
    ).toBe(true)
    expect(pathSendData).toHaveBeenCalledWith('\x7f'.repeat(11))

    const nonPathEvent = keyEvent('Backspace', { metaKey: true })
    const nonPathSendData = vi.fn()

    expect(
      handleTerminalShortcutKeydown(nonPathEvent, nonPathSendData, false, () => 'echo hello')
    ).toBe(true)
    expect(nonPathSendData).toHaveBeenCalledWith('\x15')

    const noGetterEvent = keyEvent('Backspace', { metaKey: true })
    const noGetterSendData = vi.fn()

    expect(handleTerminalShortcutKeydown(noGetterEvent, noGetterSendData)).toBe(true)
    expect(noGetterSendData).toHaveBeenCalledWith('\x15')
  })

  it('keeps terminal Meta shortcuts explicit unless Windows Alt-as-Cmd is active', () => {
    const altLeft = keyEvent('ArrowLeft', { altKey: true })
    const sendWithoutVirtualMeta = vi.fn()

    expect(handleTerminalShortcutKeydown(altLeft, sendWithoutVirtualMeta)).toBe(false)
    expect(sendWithoutVirtualMeta).not.toHaveBeenCalled()

    const windowsAltLeft = keyEvent('ArrowLeft', { altKey: true })
    const sendWithVirtualMeta = vi.fn()
    const stopPropagation = vi.spyOn(windowsAltLeft, 'stopPropagation')

    expect(handleTerminalShortcutKeydown(windowsAltLeft, sendWithVirtualMeta, true)).toBe(true)
    expect(sendWithVirtualMeta).toHaveBeenCalledWith('\x01')
    expect(windowsAltLeft.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('matches shifted physical keys for app shortcuts such as font size up', () => {
    const binding = useKeybindings().getBinding('fontSizeUp')

    expect(keyEventMatchesBinding(keyEvent('+', { code: 'Equal', shiftKey: true }), binding)).toBe(
      true
    )
    expect(
      keyEventMatchesBinding(keyEvent('+', { code: 'NumpadAdd', shiftKey: true }), binding)
    ).toBe(false)
  })

  it('does not match terminal bindings hand-edited to reserved Ctrl+Shift+C/V', () => {
    const cases = [
      ['term.lineStart', keyEvent('C', { ctrlKey: true, shiftKey: true })],
      ['term.lineEnd', keyEvent('V', { ctrlKey: true, shiftKey: true })],
    ] as const

    for (const [id, event] of cases) {
      settings.keybindings[id] = {
        key: event.key.toLowerCase(),
        shift: true,
        meta: false,
        ctrl: true,
        alt: false,
      }
      const sendData = vi.fn()
      const stopPropagation = vi.spyOn(event, 'stopPropagation')

      expect(handleTerminalShortcutKeydown(event, sendData)).toBe(false)
      expect(sendData).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
      expect(stopPropagation).not.toHaveBeenCalled()
    }
  })

  it('records literal modifiers for terminal shortcuts', async () => {
    const wrapper = await recordKey(
      'term.lineStart',
      keyEvent('x', { shiftKey: true, metaKey: true, ctrlKey: true, altKey: true })
    )

    expect(settings.keybindings['term.lineStart']).toEqual({
      key: 'x',
      shift: true,
      meta: true,
      ctrl: true,
      alt: true,
    })
    wrapper.unmount()
  })

  it('records app shortcuts with only key and shift', async () => {
    const wrapper = await recordKey(
      'newTab',
      keyEvent('x', { shiftKey: true, metaKey: true, ctrlKey: true, altKey: true })
    )

    expect(settings.keybindings.newTab).toEqual({ key: 'x', shift: true })
    wrapper.unmount()
  })

  it('rejects bare modifier presses while recording terminal shortcuts', async () => {
    const wrapper = await recordKey('term.lineEnd', keyEvent('Shift', { shiftKey: true }))

    expect(settings.keybindings['term.lineEnd']).toBeUndefined()
    expect(wrapper.find(`[data-kb-id="term.lineEnd"] [data-kb-action="stop"]`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('rejects terminal bindings reserved for Ctrl+Shift+C/V copy and paste', async () => {
    const wrapper = mount(KeyboardTab)
    await wrapper.find(`[data-kb-id="term.lineEnd"] [data-kb-action="record"]`).trigger('click')
    await nextTick()

    window.dispatchEvent(keyEvent('C', { ctrlKey: true, shiftKey: true }))
    await nextTick()
    expect(settings.keybindings['term.lineEnd']).toBeUndefined()
    expect(wrapper.text()).toContain('Ctrl+Shift+C/V are reserved')

    window.dispatchEvent(keyEvent('V', { ctrlKey: true, shiftKey: true }))
    await nextTick()
    expect(settings.keybindings['term.lineEnd']).toBeUndefined()
    wrapper.unmount()
  })

  it('accepts terminal reserved combos when another literal modifier is present', async () => {
    const wrapper = await recordKey(
      'term.lineEnd',
      keyEvent('C', { ctrlKey: true, altKey: true, shiftKey: true })
    )

    expect(settings.keybindings['term.lineEnd']).toEqual({
      key: 'c',
      shift: true,
      meta: false,
      ctrl: true,
      alt: true,
    })
    expect(wrapper.find(`[data-kb-id="term.lineEnd"] [data-kb-action="stop"]`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('reset restores the terminal default binding', async () => {
    settings.keybindings['term.lineStart'] = {
      key: 'x',
      shift: true,
      meta: false,
      ctrl: true,
      alt: false,
    }
    const wrapper = mount(KeyboardTab)

    await wrapper.find(`[data-kb-id="term.lineStart"] [data-kb-action="reset"]`).trigger('click')
    await nextTick()

    expect(settings.keybindings['term.lineStart']).toBeUndefined()
    expect(useKeybindings().getBinding('term.lineStart')).toEqual({
      key: 'arrowleft',
      shift: false,
      meta: true,
    })
    wrapper.unmount()
  })
})
