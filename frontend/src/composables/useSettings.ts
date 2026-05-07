import { reactive } from 'vue'
import { getThemeByName, applyThemeToDOM, getXtermTheme } from '../themes'
export interface SettingsData {
  theme: {
    preset: string
    custom: {
      foreground?: string
      background?: string
      cursor?: string
      ansi?: string[]
    } | null
  }
  background: {
    color: string | null
  }
  bookmarks: CommandBookmark[]
  action_keyboard: ActionKeyboardConfig | null
  locale: string
}

export interface CommandBookmark {
  id: string
  name: string
  command: string
  group: string | null
}

export interface ActionKey {
  label: string
  send: string
  style?: string
  repeat?: boolean
  special?: string
  auto_enter?: boolean
  grow?: number
}

export interface ActionKeyboardConfig {
  rows: ActionKey[][]
}

export const DEFAULT_ACTION_KEYBOARD: ActionKeyboardConfig = {
  rows: [
    [
      { label: 'esc', send: '\x1b' },
      { label: 'tab', send: '\t' },
      { label: '⇤', send: '\x1b[Z' },
      { label: '⌫', send: '\x7f', repeat: true },
    ],
    [
      { label: 'ctrl+c', send: '\x03', style: 'danger' },
      { label: 'ctrl+z', send: '\x1a' },
      { label: 'ctrl+l', send: '\x0c' },
      { label: 'ctrl+r', send: '\x12' },
      { label: 'ctrl+d', send: '\x04' },
      { label: 'ctrl+k', send: '\x0b' },
    ],
    [
      { label: 'ctrl', send: '', special: 'ctrl' },
      { label: 'opt', send: '', special: 'alt' },
      { label: '⌘', send: '', special: 'cmd' },
      { label: '', send: ' ', special: 'space' },
    ],
  ],
}

export const settings = reactive<SettingsData>({
  theme: { preset: 'dark', custom: null },
  background: { color: null },
  bookmarks: [],
  action_keyboard: null,
  locale: 'zh',
})

let loaded = false

export function useSettings() {
  if (!loaded) {
    loadSettings()
    loaded = true
  }
  return { settings, saveSettings, applyCurrentTheme, getCurrentXtermTheme }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings')
    if (res.ok) {
      const data = await res.json()
      Object.assign(settings, data)
      applyCurrentTheme()
      // Sync action keyboard to localStorage for static mobile-keyboard.js
      if (settings.action_keyboard) {
        localStorage.setItem('xterm_action_keyboard', JSON.stringify(settings.action_keyboard))
      }
    }
  } catch {}
}

async function saveSettings() {
  try {
    // Sync action keyboard to localStorage for static mobile-keyboard.js
    if (settings.action_keyboard) {
      localStorage.setItem('xterm_action_keyboard', JSON.stringify(settings.action_keyboard))
    } else {
      localStorage.removeItem('xterm_action_keyboard')
    }
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
  } catch {}
}

export function applyCurrentTheme() {
  const theme = getThemeByName(settings.theme.preset)
  applyThemeToDOM(theme)

  if (settings.background.color) {
    document.documentElement.style.setProperty('--bg', settings.background.color)
  }
}

export function getCurrentXtermTheme() {
  const theme = getThemeByName(settings.theme.preset)
  const xtermTheme = getXtermTheme(theme)
  return xtermTheme
}
