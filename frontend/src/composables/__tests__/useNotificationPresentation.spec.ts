import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../useTransport', () => ({ isTauri: () => false }))

import { __setSettingsLoadedForTest, settings as serverSettings } from '../useSettings'
import {
  __resetNotificationPresentationForTest,
  createPresentationScheduler,
  DEFAULT_NOTIFICATION_PRESENTATION_SETTINGS,
  isInQuietHours,
  NOTIFICATION_PRESENTATION_MIGRATION_KEY,
  NOTIFICATION_PRESENTATION_STORAGE_KEY,
  presentationGate,
  useNotificationPresentation,
  type NotificationPresentationSettings,
  type PresentationEvent,
} from '../useNotificationPresentation'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

function cloneSettings(): NotificationPresentationSettings {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PRESENTATION_SETTINGS))
}

function gate(
  settings: NotificationPresentationSettings,
  overrides: Partial<{
    paneId: string
    focusedPaneId: string | null
    activeTabPaneIds: string[]
    foreground: boolean
    now: Date
  }> = {},
) {
  return presentationGate(
    { paneId: overrides.paneId ?? 'pane-a', severity: 'info' },
    {
      settings,
      focusedPaneId: overrides.focusedPaneId ?? null,
      activeTabPaneIds: overrides.activeTabPaneIds ?? [],
      isAppForeground: overrides.foreground ?? false,
      now: () => overrides.now ?? new Date(2026, 6, 16, 12, 0),
    },
  )
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  __setSettingsLoadedForTest(true)
  __resetNotificationPresentationForTest()
  ;(serverSettings as any).notification = {
    enabled: true,
    bell: { enabled: true, debounce_ms: 300 },
    osc_notify: true,
    command_complete: { enabled: false, threshold_seconds: 10 },
    keyword_match: [],
    hooks: [],
    channels: { sound: true, vibration: true, panel: true, tab_indicator: true },
    sounds: cloneSettings().sounds,
  }
})

afterEach(() => {
  __resetNotificationPresentationForTest()
  vi.useRealTimers()
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('presentationGate output vector', () => {
  it('composes base, E1, active-leaf, D2, and E5 across a Cartesian sweep', () => {
    for (let channelMask = 0; channelMask < 16; channelMask++) {
      for (const presentationEnabled of [false, true]) {
        for (const dndLevel of ['normal', 'dot_sound', 'silent'] as const) {
          for (const focusedPane of [false, true]) {
            for (const foreground of [false, true]) {
              for (const ignoreCurrentTab of [false, true]) {
                for (const activeTabMember of [false, true]) {
                  for (const quiet of [false, true]) {
                const settings = cloneSettings()
                settings.presentation_enabled = presentationEnabled
                settings.channels = {
                  sound: !!(channelMask & 1),
                  vibration: !!(channelMask & 2),
                  panel: !!(channelMask & 4),
                  tab_indicator: !!(channelMask & 8),
                }
                settings.dnd_level = dndLevel
                settings.ignore_current_tab = ignoreCurrentTab
                settings.quiet_hours = quiet
                  ? { start: '11:00', end: '13:00' }
                  : { start: '22:00', end: '22:00' }

                const expected = presentationEnabled ? {
                  storeHistory: settings.channels.panel,
                  showTabIndicator: settings.channels.tab_indicator,
                  showPopup: settings.channels.panel,
                  playSound: settings.channels.sound,
                  vibrate: settings.channels.vibration,
                } : {
                  storeHistory: false,
                  showTabIndicator: false,
                  showPopup: false,
                  playSound: false,
                  vibrate: false,
                }
                if (dndLevel === 'dot_sound') {
                  expected.showPopup = false
                  expected.vibrate = false
                } else if (dndLevel === 'silent') {
                  expected.showPopup = false
                  expected.playSound = false
                  expected.vibrate = false
                }
                if (focusedPane && foreground) {
                  expected.showPopup = false
                  expected.playSound = false
                  expected.vibrate = false
                }
                if (ignoreCurrentTab && activeTabMember) expected.showPopup = false
                if (quiet) {
                  expected.showPopup = false
                  expected.playSound = false
                  expected.vibrate = false
                }

                expect(gate(settings, {
                  focusedPaneId: focusedPane ? 'pane-a' : 'pane-b',
                  activeTabPaneIds: activeTabMember ? ['pane-a'] : [],
                  foreground,
                })).toEqual(expected)
                  }
                }
              }
            }
          }
        }
      }
    }
  })

  it('seeds every base channel for every toggle combination and disables all when presentation is off', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const enabled of [false, true]) {
        const settings = cloneSettings()
        settings.presentation_enabled = enabled
        settings.channels = {
          sound: !!(mask & 1),
          vibration: !!(mask & 2),
          panel: !!(mask & 4),
          tab_indicator: !!(mask & 8),
        }
        const output = gate(settings)
        expect(output).toEqual(enabled ? {
          storeHistory: settings.channels.panel,
          showTabIndicator: settings.channels.tab_indicator,
          showPopup: settings.channels.panel,
          playSound: settings.channels.sound,
          vibrate: settings.channels.vibration,
        } : {
          storeHistory: false,
          showTabIndicator: false,
          showPopup: false,
          playSound: false,
          vibrate: false,
        })
      }
    }
  })

  it.each([
    ['normal', { showPopup: true, playSound: true, vibrate: true }],
    ['dot_sound', { showPopup: false, playSound: true, vibrate: false }],
    ['silent', { showPopup: false, playSound: false, vibrate: false }],
  ] as const)('applies E1 %s without changing history or indicator', (level, emit) => {
    const settings = cloneSettings()
    settings.dnd_level = level
    expect(gate(settings)).toEqual({ storeHistory: true, showTabIndicator: true, ...emit })
  })

  it('silences popup/sound/vibration for the focused foreground leaf only', () => {
    const output = gate(cloneSettings(), {
      paneId: 'leaf-a', focusedPaneId: 'leaf-a', activeTabPaneIds: ['leaf-a'], foreground: true,
    })
    expect(output).toEqual({
      storeHistory: true,
      showTabIndicator: true,
      showPopup: false,
      playSound: false,
      vibrate: false,
    })
  })

  it('D2 clears popup only for a background split leaf in the active tab', () => {
    const settings = cloneSettings()
    settings.ignore_current_tab = true
    const output = gate(settings, {
      paneId: 'leaf-b', focusedPaneId: 'leaf-a', activeTabPaneIds: ['tab-a', 'leaf-a', 'leaf-b'],
      foreground: true,
    })
    expect(output).toMatchObject({ showPopup: false, playSound: true, vibrate: true })
  })
})

describe('quiet hours', () => {
  it('uses half-open normal-window boundaries', () => {
    const quiet = { start: '09:30', end: '11:00' }
    expect(isInQuietHours(quiet, new Date(2026, 6, 16, 9, 30))).toBe(true)
    expect(isInQuietHours(quiet, new Date(2026, 6, 16, 11, 0))).toBe(false)
  })

  it('handles both sides of a cross-midnight window', () => {
    const quiet = { start: '22:00', end: '06:00' }
    expect(isInQuietHours(quiet, new Date(2026, 6, 16, 23, 30))).toBe(true)
    expect(isInQuietHours(quiet, new Date(2026, 6, 17, 1, 30))).toBe(true)
    expect(isInQuietHours(quiet, new Date(2026, 6, 17, 6, 0))).toBe(false)
  })

  it('treats equal start/end as never quiet', () => {
    const quiet = { start: '00:00', end: '00:00' }
    expect(isInQuietHours(quiet, new Date(2026, 6, 16, 0, 0))).toBe(false)
    expect(isInQuietHours(quiet, new Date(2026, 6, 16, 12, 0))).toBe(false)
  })

  it('clears all emit channels while preserving history and indicator', () => {
    const settings = cloneSettings()
    settings.quiet_hours = { start: '09:00', end: '17:00' }
    expect(gate(settings, { now: new Date(2026, 6, 16, 10, 0) })).toEqual({
      storeHistory: true,
      showTabIndicator: true,
      showPopup: false,
      playSound: false,
      vibrate: false,
    })
  })
})

describe('presentation coalesce scheduler', () => {
  beforeEach(() => vi.useFakeTimers())

  it('collapses 10 same-pane events into one whole-vector firing while history remains per-event', () => {
    const popup = vi.fn()
    const sound = vi.fn()
    const vibrate = vi.fn()
    let historyCards = 0
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 300,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: true, vibrate: true }),
      fire: (_event, output) => {
        if (output.showPopup) popup()
        if (output.playSound) sound()
        if (output.vibrate) vibrate()
      },
    })
    for (let seq = 1; seq <= 10; seq++) {
      historyCards++
      scheduler.enqueue({ paneId: 'pane-a', eventSeq: String(seq), severity: 'info' })
      vi.advanceTimersByTime(20)
    }
    vi.advanceTimersByTime(300)
    expect(historyCards).toBe(10)
    expect(popup).toHaveBeenCalledOnce()
    expect(sound).toHaveBeenCalledOnce()
    expect(vibrate).toHaveBeenCalledOnce()
  })

  it('selects highest severity and uses the latest event to break ties', () => {
    const fired: PresentationEvent[] = []
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: true, vibrate: true }),
      fire: (event) => fired.push(event),
    })
    scheduler.enqueue({ paneId: 'p', eventSeq: '1', severity: 'warning' })
    scheduler.enqueue({ paneId: 'p', eventSeq: '2', severity: 'error' })
    scheduler.enqueue({ paneId: 'p', eventSeq: '3', severity: 'error' })
    scheduler.enqueue({ paneId: 'p', eventSeq: '4', severity: 'info' })
    vi.advanceTimersByTime(100)
    expect(fired[0]).toMatchObject({ eventSeq: '3', severity: 'error' })
  })

  it('cancels a pending pane at its read watermark and permits a newer sequence', () => {
    const fired: PresentationEvent[] = []
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: true, vibrate: true }),
      fire: (event) => fired.push(event),
    })
    scheduler.enqueue({ paneId: 'p', eventSeq: '5', severity: 'urgent' })
    scheduler.cancelPane('p', '5')
    vi.advanceTimersByTime(100)
    expect(fired).toHaveLength(0)

    expect(scheduler.enqueue({ paneId: 'p', eventSeq: '5', severity: 'urgent' })).toBe(false)
    expect(scheduler.enqueue({ paneId: 'p', eventSeq: '6', severity: 'info' })).toBe(true)
    vi.advanceTimersByTime(100)
    expect(fired).toHaveLength(1)
    expect(fired[0].eventSeq).toBe('6')
  })

  it('cancels the whole pane entry on read intent even when an older watermark exists', () => {
    const fired = vi.fn()
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: true, vibrate: true }),
      fire: fired,
    })
    scheduler.cancelPane('pane-a', '5')
    scheduler.enqueue({ paneId: 'pane-a', eventSeq: '6', severity: 'info' })
    scheduler.cancelPane('pane-a')
    vi.advanceTimersByTime(100)
    expect(fired).not.toHaveBeenCalled()
  })

  it('re-evaluates masks using settings at fire time', () => {
    const settings = cloneSettings()
    const fired: unknown[] = []
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: (event) => presentationGate(event, {
        settings, focusedPaneId: null, activeTabPaneIds: [], isAppForeground: false,
        now: () => new Date(2026, 6, 16, 12, 0),
      }),
      fire: (_event, output) => fired.push(output),
    })
    scheduler.enqueue({ paneId: 'p', eventSeq: '1', severity: 'info' })
    settings.dnd_level = 'silent'
    vi.advanceTimersByTime(100)
    expect(fired).toHaveLength(0)
  })

  it('re-evaluates focused-pane context at fire time', () => {
    const settings = cloneSettings()
    let focusedPaneId: string | null = 'pane-b'
    const fired = vi.fn()
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: (event) => presentationGate(event, {
        settings,
        focusedPaneId,
        activeTabPaneIds: [],
        isAppForeground: true,
        now: () => new Date(2026, 6, 16, 12, 0),
      }),
      fire: fired,
    })
    scheduler.enqueue({ paneId: 'pane-a', eventSeq: '1', severity: 'info' })
    focusedPaneId = 'pane-a'
    vi.advanceTimersByTime(100)
    expect(fired).not.toHaveBeenCalled()
  })

  it('keeps pane and pane-less notification identities isolated from old-key collisions', () => {
    const fired: PresentationEvent[] = []
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: false, vibrate: false }),
      fire: (event) => fired.push(event),
    })
    scheduler.enqueue({ paneId: 'pane-less-1', eventSeq: '1', severity: 'warning' })
    scheduler.enqueue({ notifId: 'notif-a', severity: 'error' })
    scheduler.cancelNotif('notif-a')
    vi.advanceTimersByTime(100)
    expect(fired).toEqual([{ paneId: 'pane-less-1', eventSeq: '1', severity: 'warning' }])
  })

  it('disposes every pending timer and watermark without later fires', () => {
    const fired = vi.fn()
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => 100,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: true, vibrate: true }),
      fire: fired,
    })
    scheduler.enqueue({ paneId: 'pane-a', eventSeq: '5', severity: 'info' })
    scheduler.enqueue({ notifId: 'notif-a', severity: 'warning' })
    scheduler.cancelPane('watermarked', '9')
    scheduler.dispose()
    expect(scheduler.pendingCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(fired).not.toHaveBeenCalled()
    expect(scheduler.enqueue({ paneId: 'watermarked', eventSeq: '1', severity: 'info' })).toBe(true)
  })

  it('is independent of the server ingest debounce setting', () => {
    let coalesceWindow = 100
    ;(serverSettings.notification.bell as any).debounce_ms = 5000
    const fired = vi.fn()
    const scheduler = createPresentationScheduler<PresentationEvent>({
      getWindowMs: () => coalesceWindow,
      evaluate: () => ({ storeHistory: true, showTabIndicator: true, showPopup: true, playSound: false, vibrate: false }),
      fire: fired,
    })
    scheduler.enqueue({ paneId: 'p', eventSeq: '1', severity: 'info' })
    vi.advanceTimersByTime(99)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalledOnce()
    coalesceWindow = 25
    expect(serverSettings.notification.bell.debounce_ms).toBe(5000)
  })
})

describe('guarded local presentation store', () => {
  it('keeps functioning in memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('private mode') },
      setItem: () => { throw new Error('private mode') },
      removeItem: () => { throw new Error('private mode') },
    })
    __resetNotificationPresentationForTest()
    const store = useNotificationPresentation()
    store.settings.dnd_level = 'silent'
    expect(store.settings.dnd_level).toBe('silent')
    expect(store.isEphemeral.value).toBe(true)
  })

  it('deletes malformed JSON instead of crashing', () => {
    localStorage.setItem(NOTIFICATION_PRESENTATION_STORAGE_KEY, '{bad json')
    const removeSpy = vi.spyOn(localStorage, 'removeItem')
    expect(() => useNotificationPresentation()).not.toThrow()
    expect(removeSpy).toHaveBeenCalledWith(NOTIFICATION_PRESENTATION_STORAGE_KEY)
  })

  it('exposes ephemeral mode when the migration marker cannot be written', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => {
        if (key === NOTIFICATION_PRESENTATION_MIGRATION_KEY) throw new Error('quota')
        values.set(key, value)
      },
    })
    __resetNotificationPresentationForTest()
    expect(useNotificationPresentation().isEphemeral.value).toBe(true)
    expect(values.has(NOTIFICATION_PRESENTATION_MIGRATION_KEY)).toBe(false)
    expect(values.has(NOTIFICATION_PRESENTATION_STORAGE_KEY)).toBe(false)
  })

  it('migrates server presentation fields exactly once and ignores later server changes', () => {
    ;(serverSettings as any).notification = {
      ...(serverSettings.notification as any),
      channels: { sound: false, vibration: true, panel: false, tab_indicator: true },
      sounds: cloneSettings().sounds,
    }
    let store = useNotificationPresentation()
    expect(store.settings.channels).toEqual({
      sound: false, vibration: true, panel: false, tab_indicator: true,
    })
    expect(localStorage.getItem(NOTIFICATION_PRESENTATION_MIGRATION_KEY)).toBe('1')

    ;(serverSettings as any).notification = {
      ...(serverSettings.notification as any),
      channels: { sound: true, vibration: false, panel: true, tab_indicator: false },
      sounds: cloneSettings().sounds,
    }
    __resetNotificationPresentationForTest()
    store = useNotificationPresentation()
    expect(store.settings.channels).toEqual({
      sound: false, vibration: true, panel: false, tab_indicator: true,
    })
  })

  it('waits for successful settings load before seeding real server values', () => {
    __setSettingsLoadedForTest(false)
    __resetNotificationPresentationForTest()
    const store = useNotificationPresentation()
    expect(store.settings.channels.sound).toBe(true)
    expect(localStorage.getItem(NOTIFICATION_PRESENTATION_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(NOTIFICATION_PRESENTATION_MIGRATION_KEY)).toBeNull()

    ;(serverSettings.notification as any).channels = {
      sound: false, vibration: false, panel: true, tab_indicator: false,
    }
    __setSettingsLoadedForTest(true)

    expect(store.settings.channels).toEqual({
      sound: false, vibration: false, panel: true, tab_indicator: false,
    })
    expect(localStorage.getItem(NOTIFICATION_PRESENTATION_MIGRATION_KEY)).toBe('1')
  })

  it('keeps marker-failure edits ephemeral and retries fresh server migration next session', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => {
        if (key === NOTIFICATION_PRESENTATION_MIGRATION_KEY) throw new Error('quota')
        values.set(key, value)
      },
    })
    __resetNotificationPresentationForTest()
    let store = useNotificationPresentation()
    store.settings.channels.sound = false
    expect(store.isEphemeral.value).toBe(true)
    expect(values.has(NOTIFICATION_PRESENTATION_MIGRATION_KEY)).toBe(false)
    expect(values.has(NOTIFICATION_PRESENTATION_STORAGE_KEY)).toBe(false)

    __resetNotificationPresentationForTest()
    store = useNotificationPresentation()
    expect(store.settings.channels.sound).toBe(true)
    expect(store.isEphemeral.value).toBe(true)
    expect(values.has(NOTIFICATION_PRESENTATION_MIGRATION_KEY)).toBe(false)
    expect(values.has(NOTIFICATION_PRESENTATION_STORAGE_KEY)).toBe(false)
  })
})
