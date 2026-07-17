import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub WebSocket to a no-op shim — happy-dom may not provide a real one
// in some test runners, and App.vue's connectSyncWS will read its
// readyState. We set readyState=CONNECTING (0) so the fallback timer
// fires apiListTabs and populates tabs.
const originalWebSocket = (global as any).WebSocket
class MockWebSocket {
  public readyState = 0
  public onopen: any = null
  public onmessage: any = null
  public onclose: any = null
  public onerror: any = null
  constructor(public url: string) {}
  close() {}
}
;(global as any).WebSocket = MockWebSocket as any
;(global as any).WebSocket.OPEN = 1
;(global as any).WebSocket.CONNECTING = 0
;(global as any).WebSocket.CLOSED = 3

// Stub localStorage so persist() can write without throwing
const originalLocalStorage = (global as any).localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem(key: string) {
    return this.store[key] ?? null
  },
  setItem(key: string, value: string) {
    this.store[key] = value
  },
  removeItem(key: string) {
    delete this.store[key]
  },
  clear() {
    this.store = {}
  },
}
;(global as any).localStorage = localStorageMock

// vi.mock factories are hoisted; vi.hoisted lets us share spies with them.
const mocks = vi.hoisted(() => ({
  closePane: vi.fn<(paneId: string) => Promise<boolean>>(),
  splitPane: vi.fn(),
  toggleBroadcast: vi.fn(),
  toggleZoom: vi.fn(),
  equalizePanes: vi.fn(),
  focusPane: vi.fn(),
  focusNext: vi.fn(),
  focusPrev: vi.fn(),
  keyboardResize: vi.fn(),
  reorderPane: vi.fn(),
  onTerminalInput: vi.fn(),
  focusNeighbor: vi.fn(),
  apiCreateTab: vi.fn(async () => ({
    tab_id: 't-new',
    pane_id: 'p-new',
    layout: { type: 'leaf', paneId: 'p-new', title: 'Terminal', ratio: 1, zoomed: false },
  })),
  apiCloseTab: vi.fn(async () => {}),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  getAuthToken: () => 'token',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  fetchAutoToken: async () => '',
  validateToken: async () => ({ ok: true }),
  hasAuthToken: () => true,
  wsUrlWithToken: (url: string) => url,
  checkTokenConfigured: async () => false,
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false, tauriInvoke: vi.fn() }))
vi.mock('../composables/useTerminal', () => ({
  isTouchDevice: () => false,
  setActivePaneId: () => {},
}))
vi.mock('../utils/clientPlatform', () => ({ isWindowsClient: true }))
// Per-binding key map so Cmd+W can be dispatched without colliding with
// other keyActions in onGlobalKeydown (the first matching binding wins).
const BINDING_KEYS: Record<string, string> = {
  togglePalette: 'p',
  openBookmarks: 'b',
  newTab: 't',
  closeTab: 'w',
  splitHorizontal: 'd',
  splitVertical: 'e',
  toggleBroadcast: 'g',
  toggleZoom: 'z',
  equalizePanes: '=',
  focusNextPane: ']',
  focusPrevPane: '[',
  searchTerminal: 'f',
  missionControl: 'm',
  sshConnect: 's',
  fontSizeUp: '=',
  fontSizeDown: '-',
  fontSizeReset: '0',
}
vi.mock('../composables/useKeybindings', () => ({
  useKeybindings: () => ({
    getBinding: (id: string) => ({ key: BINDING_KEYS[id] ?? 'x', shift: false }),
    formatBinding: (b: any) => b.key,
  }),
  keyEventMatchesBinding: (e: KeyboardEvent, binding: { key: string; shift: boolean }) =>
    e.key.toLowerCase() === binding.key.toLowerCase() && e.shiftKey === binding.shift,
}))
vi.mock('../composables/useMonitor', () => ({ initMonitorHistory: () => {} }))
vi.mock('../composables/useNotification', () => ({
  useNotification: () => ({
    notifications: { value: [] },
    unreadCount: { value: 0 },
    unreadByPane: {},
    togglePanel: vi.fn(),
    clearPaneUnread: vi.fn(),
    clearForPaneIds: vi.fn(),
    setGoToPaneHandler: vi.fn(),
  }),
  aggregateSeverity: vi.fn(() => null),
  pushNotification: vi.fn(),
  setToastInstance: vi.fn(),
}))
vi.mock('../composables/usePluginLoader', () => ({
  usePluginLoader: () => ({
    loadedPlugins: new Map(),
    loadAll: vi.fn(),
    getPluginContext: vi.fn(),
    pluginList: { value: [], __v_isRef: true },
    allCommands: { value: [], __v_isRef: true },
    allQuickPicks: { value: [], __v_isRef: true },
  }),
  handlePluginChanged: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiCreateTab: mocks.apiCreateTab,
  apiCloseTab: mocks.apiCloseTab,
  apiClosePane: vi.fn(async () => ({ tab_closed: false })),
  apiActivatePane: vi.fn(async () => {}),
  apiListTabs: vi.fn(async () => ({
    tabs: [
      {
        tab_id: 'tab-1',
        pane_id: 'pane-1',
        active_pane_id: 'pane-1',
        layout: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          children: [
            { type: 'leaf', paneId: 'pane-1', title: 'P1', ratio: 1, zoomed: false },
            { type: 'leaf', paneId: 'pane-2', title: 'P2', ratio: 1, zoomed: false },
          ],
        },
      },
    ],
    active_pane_id: 'pane-1',
  })),
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: { value: 'zh' }, setLocale: vi.fn() }),
}))

vi.mock('../composables/useSplitPane', () => ({
  useSplitPane: () => ({
    closePane: mocks.closePane,
    splitPane: mocks.splitPane,
    toggleBroadcast: mocks.toggleBroadcast,
    toggleZoom: mocks.toggleZoom,
    equalizePanes: mocks.equalizePanes,
    focusPane: mocks.focusPane,
    focusNext: mocks.focusNext,
    focusPrev: mocks.focusPrev,
    keyboardResize: mocks.keyboardResize,
    reorderPane: mocks.reorderPane,
    onTerminalInput: mocks.onTerminalInput,
    focusNeighbor: mocks.focusNeighbor,
  }),
}))

import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { nextTick, defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import App from '../App.vue'
import { settings } from '../composables/useSettings'
import { useUiStore } from '../stores/uiStore'

// Spec: openspec/changes/confirm-before-close-tab/spec.md
//   "### Requirement: Pane Close Confirmation"
//   "### Scenario: Pane close in split-screen triggers confirmation"
// Every pane is an independent terminal session. Closing any pane must
// route through the same confirmation gate as closing the whole tab.

// A SplitContainer stub that proxies emits — when App.vue's template wires
// `@close="(id) => onClosePane(tab.paneId, id)"` and the stub fires `close`,
// the inline arrow handler runs against the live `tabs` state.
const SplitContainerStub = defineComponent({
  name: 'SplitContainer',
  emits: [
    'close',
    'register',
    'title-change',
    'focus',
    'input',
    'file-click',
    'preview-link',
    'link-activate',
    'reorder',
    'divider-drag-end',
  ],
  setup(_, { emit }) {
    return () => h('div', { class: 'split-stub' })
  },
})

const ConfirmModalStub = defineComponent({
  name: 'ConfirmModal',
  props: ['visible', 'title', 'message', 'confirmText', 'cancelText'],
  emits: ['confirm', 'cancel'],
  setup(props, { emit }) {
    return () =>
      h('div', {
        class: 'confirm-stub',
        'data-visible': String(props.visible),
        onClick: () => emit('confirm'),
      })
  },
})

const ConfirmCloseDialogStub = defineComponent({
  name: 'ConfirmCloseDialog',
  emits: ['confirm'],
  setup(_, { emit }) {
    const ui = useUiStore()
    return () =>
      h('div', {
        class: 'confirm-close-stub',
        'data-visible': String(ui.confirmCloseVisible),
        onClick: () => emit('confirm', ui.pendingCloseTabId, ui.pendingClosePaneId),
      })
  },
})

let mountedWrapper: VueWrapper | undefined

async function mountWithTabs() {
  vi.useFakeTimers()
  const wrapper = shallowMount(App, {
    global: {
      plugins: [createPinia()],
      stubs: {
        SplitContainer: SplitContainerStub,
        ConfirmCloseDialog: ConfirmCloseDialogStub,
        ConfirmModal: ConfirmModalStub,
      },
    },
  })
  mountedWrapper = wrapper
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  // Fast-forward past the 3-second REST fallback timer in App.vue's onMounted.
  await vi.advanceTimersByTimeAsync(3500)
  await nextTick()
  await nextTick()
  vi.useRealTimers()
  return wrapper
}

afterEach(() => {
  mountedWrapper?.unmount()
  mountedWrapper = undefined
  vi.useRealTimers()
  localStorageMock.clear()
})

afterAll(() => {
  if (originalWebSocket === undefined) delete (global as any).WebSocket
  else (global as any).WebSocket = originalWebSocket

  if (originalLocalStorage === undefined) delete (global as any).localStorage
  else (global as any).localStorage = originalLocalStorage
})

describe('App.vue - onClosePane routes through confirmation gate', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    settings.windowsAltAsCmd = false
    mocks.closePane.mockReset()
    mocks.splitPane.mockReset()
    mocks.toggleBroadcast.mockReset()
    mocks.toggleZoom.mockReset()
    mocks.equalizePanes.mockReset()
    mocks.focusPane.mockReset()
    mocks.focusNext.mockReset()
    mocks.focusPrev.mockReset()
    mocks.keyboardResize.mockReset()
    mocks.reorderPane.mockReset()
    mocks.onTerminalInput.mockReset()
    mocks.focusNeighbor.mockReset()
    mocks.apiCreateTab.mockClear()
    mocks.apiCloseTab.mockReset()
    localStorageMock.clear()
  })

  it('terminal tab + setting on + close pane → sets pending state, does NOT close immediately', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    expect(splitContainer.exists()).toBe(true)

    // Fire the `close` emit that App.vue wires to onClosePane(tab.paneId, id)
    await splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    // closePane must NOT have been called yet — we expect the modal gate
    expect(mocks.closePane).not.toHaveBeenCalled()

    // Confirm close dialog must now be visible
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.exists()).toBe(true)
    expect(confirmDialog.attributes('data-visible')).toBe('true')
  })

  it('onConfirmClose with pendingClosePaneId → calls splitPane.closePane, not closeTab', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-2')
    await nextTick()

    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    await confirmDialog.trigger('click')
    await nextTick()

    // splitPane.closePane should be called with the pane id
    expect(mocks.closePane).toHaveBeenCalledWith('pane-2')

    // apiCloseTab should NOT have been called (closePane returned true)
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()

    // Modal should be closed
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  it('onConfirmClose with pane close cascade (closePane returns false) → calls closeTab fallback', async () => {
    mocks.closePane.mockResolvedValue(false)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-3')
    await nextTick()

    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    await confirmDialog.trigger('click')
    await nextTick()

    // splitPane.closePane should be called first
    expect(mocks.closePane).toHaveBeenCalledWith('pane-3')

    // Since closePane returned false, the tab should be closed (cascade fallback)
    expect(mocks.apiCloseTab).toHaveBeenCalled()
  })

  it('bypass with setting off + closePane returns false → falls back to closeTab', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(false)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    // closePane should be called directly (bypass)
    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // Since closePane returned false, closeTab should be the fallback
    expect(mocks.apiCloseTab).toHaveBeenCalled()
  })

  it('bypass with setting off + closePane returns true → does NOT call closeTab', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
  })
})

describe('App.vue - Cmd+W routes through confirmation gate in split-pane mode', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    settings.windowsAltAsCmd = false
    mocks.closePane.mockReset()
    mocks.splitPane.mockReset()
    mocks.toggleBroadcast.mockReset()
    mocks.toggleZoom.mockReset()
    mocks.equalizePanes.mockReset()
    mocks.focusPane.mockReset()
    mocks.focusNext.mockReset()
    mocks.focusPrev.mockReset()
    mocks.keyboardResize.mockReset()
    mocks.reorderPane.mockReset()
    mocks.onTerminalInput.mockReset()
    mocks.focusNeighbor.mockReset()
    mocks.apiCreateTab.mockClear()
    mocks.apiCloseTab.mockReset()
    localStorageMock.clear()
  })

  it('Cmd+W on multi-pane layout → does NOT closePane, shows modal', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    // Dispatch Cmd+W (stubbed key 'w' for closeTab binding).
    // App.vue attaches the keydown listener to `document`.
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    // closePane must NOT have been called yet — we expect the modal gate
    expect(mocks.closePane).not.toHaveBeenCalled()

    // Confirm close dialog must now be visible
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.exists()).toBe(true)
    expect(confirmDialog.attributes('data-visible')).toBe('true')
  })

  it('Cmd+W + confirm in multi-pane mode → calls splitPane.closePane with active pane id', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    await confirmDialog.trigger('click')
    await nextTick()

    // closePane should be called with the active pane id (pane-1 in fixture)
    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // apiCloseTab should NOT have been called (closePane returned true)
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    // Modal should be closed
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  it('Cmd+W + setting off → bypasses modal and calls closePane directly', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // Modal should NOT be visible (bypass)
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  // 验证 Windows Alt-as-Cmd 不会把 Ctrl+Alt+W 当作应用关闭快捷键。
  it('Windows Alt-as-Cmd enabled + Ctrl+Alt+W → does not trigger app close', async () => {
    settings.windowsAltAsCmd = true
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  // 验证 Windows Alt-as-Cmd 开启后 Alt+W 会走关闭确认流程。
  it('Windows Alt-as-Cmd enabled + Alt+W → routes through the close confirmation gate', async () => {
    settings.windowsAltAsCmd = true
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('true')
  })

  // 验证 Windows Alt-as-Cmd 开启后 Alt+T 会创建新 tab。
  it('Windows Alt-as-Cmd enabled + Alt+T → creates a new tab', async () => {
    settings.windowsAltAsCmd = true

    await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 't',
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()
    await Promise.resolve()

    expect(mocks.apiCreateTab).toHaveBeenCalledTimes(1)
  })

  // 验证未开启 Windows Alt-as-Cmd 时 Alt+W 不会触发应用关闭。
  it('Windows Alt-as-Cmd disabled + Alt+W → does not trigger app close', async () => {
    settings.windowsAltAsCmd = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  // 验证 Ctrl+Alt+T/W 不会被虚拟 Cmd 处理，避免影响 AltGr 输入。
  it('Windows Alt-as-Cmd enabled + Ctrl+Alt+T/W → does not trigger app shortcuts', async () => {
    settings.windowsAltAsCmd = true
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    for (const key of ['t', 'w']) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        })
      )
      await nextTick()
    }

    expect(mocks.apiCreateTab).not.toHaveBeenCalled()
    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })
})
