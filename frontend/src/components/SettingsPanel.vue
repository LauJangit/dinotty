<template>
  <div class="settings-backdrop" :class="{ open }" @click.self="$emit('close')">
    <div class="settings-panel" :class="{ open }">
      <div class="settings-header">
        <h2>{{ t('settings.title') }}</h2>
        <button class="settings-close" @click="$emit('close')">✕</button>
      </div>

      <div class="settings-body">
        <section class="settings-section">
          <h3>{{ t('settings.language') }}</h3>
          <div class="settings-row">
            <select v-model="settings.locale" class="shortcut-input" style="flex:1">
              <option value="zh">{{ t('settings.lang.zh') }}</option>
              <option value="en">{{ t('settings.lang.en') }}</option>
            </select>
          </div>
        </section>

        <!-- Theme -->
        <section class="settings-section">
          <h3>{{ t('settings.theme') }}</h3>
          <div class="theme-grid">
            <button
              v-for="th in themes"
              :key="th.name"
              class="theme-card"
              :class="{ active: settings.theme.preset === th.name }"
              @click="selectTheme(th.name)"
            >
              <div class="theme-preview" :style="{ background: th.colors['--bg'], color: th.colors['--fg'] }">
                <span class="theme-sample" :style="{ color: th.colors['--color-green'] }">$</span>
                <span class="theme-sample" :style="{ color: th.colors['--fg'] }"> ls</span>
              </div>
              <span class="theme-name">{{ themeLabel(th.name) }}</span>
            </button>
          </div>
        </section>

        <!-- Action Keyboard -->
        <section class="settings-section">
          <h3>{{ t('settings.actionKeyboard') }}</h3>
          <p class="settings-hint">{{ t('settings.akHint') }}</p>
          <div class="ak-wysiwyg">
            <div v-for="(row, ri) in actionRows" :key="ri" class="ak-wyg-row-outer">
              <div class="mkb-row-wrap">
                <div class="mkb-row">
                  <div
                    v-if="ri === 0"
                    class="mkb-btn mkb-mod mkb-action-back ak-wyg-chrome"
                    style="flex-grow: 1.5; flex-basis: 0"
                  >⌨</div>
                  <div
                    v-for="(key, ki) in row"
                    :key="akItemKey(key)"
                    class="ak-wyg-slot"
                    :style="akPreviewSlotStyle(ri, ki)"
                  >
                    <div
                      class="mkb-btn ak-wyg-key"
                      :class="[previewDef(ri, ki).cls]"
                    >
                      <span class="ak-wyg-label" @click="editActionKey(ri, ki)">{{ previewLabel(key) }}</span>
                      <button type="button" class="ak-key-del" @click.stop="removeActionKey(ri, ki)">✕</button>
                      <div
                        class="ak-key-resize"
                        :title="t('settings.dragResize')"
                        @pointerdown="akResizePointerDown(ri, ki, $event)"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    class="mkb-btn mkb-mod ak-wyg-add-key"
                    @click="addActionKey(ri)"
                  >+</button>
                </div>
              </div>
              <button
                v-if="actionRows.length > 1"
                type="button"
                class="ak-wyg-remove-row"
                :title="t('settings.deleteRow')"
                @click="removeActionRow(ri)"
              >✕</button>
            </div>

            <div class="mkb-action-arrow-enter ak-wyg-fixed-cluster">
              <div class="mkb-action-arrowpad">
                <div class="mkb-action-arrow-top">
                  <div class="mkb-btn mkb-mod mkb-action-arrow">↑</div>
                </div>
                <div class="mkb-action-arrow-bot">
                  <div class="mkb-btn mkb-mod mkb-action-arrow">←</div>
                  <div class="mkb-btn mkb-mod mkb-action-arrow">↓</div>
                  <div class="mkb-btn mkb-mod mkb-action-arrow">→</div>
                </div>
              </div>
              <div class="mkb-btn mkb-mod mkb-action-enter mkb-return">↵</div>
            </div>
          </div>
          <div class="ak-actions">
            <button class="shortcut-add" @click="addActionRow">{{ t('settings.addRow') }}</button>
            <button class="shortcut-add ak-reset" @click="resetActionKeyboard">{{ t('settings.resetDefault') }}</button>
          </div>

          <!-- Edit modal -->
          <div v-if="akEdit" class="ak-modal-backdrop" @click.self="akEdit = null">
            <div class="ak-modal">
              <h4>{{ t('settings.editKey') }}</h4>
              <label class="ak-field">
                <span>{{ t('settings.label') }}</span>
                <input v-model="akEdit.label" class="shortcut-input" />
              </label>
              <label class="ak-field">
                <span>{{ t('settings.send') }}</span>
                <textarea v-model="akEdit.sendRaw" class="shortcut-input ak-send-textarea" rows="4" spellcheck="false" :placeholder="t('settings.sendPlaceholder')" />
              </label>
              <div class="ak-send-row">
                <code class="ak-esc-preview">{{ akSendPreview }}</code>
                <button type="button" class="ak-record-btn" :class="{ recording: akRecording }" @click.stop="toggleRecord">
                  {{ akRecording ? t('settings.stop') : t('settings.record') }}
                </button>
              </div>
              <div
                v-show="akRecording"
                ref="recordFocusSinkRef"
                class="ak-record-focus-sink"
                tabindex="-1"
                aria-hidden="true"
              />
              <label class="ak-field">
                <span>{{ t('settings.style') }}</span>
                <select v-model="akEdit.style" class="shortcut-input">
                  <option value="">{{ t('settings.style.normal') }}</option>
                  <option value="danger">{{ t('settings.style.danger') }}</option>
                </select>
              </label>
              <label class="shortcut-check">
                <input type="checkbox" v-model="akEdit.auto_enter" /> {{ t('settings.appendEnter') }}
              </label>
              <label class="shortcut-check">
                <input type="checkbox" v-model="akEdit.repeat" /> {{ t('settings.repeatHold') }}
              </label>
              <div class="ak-modal-actions">
                <button class="settings-save" @click="saveActionKey">{{ t('settings.save') }}</button>
                <button class="shortcut-add" @click="akEdit = null">{{ t('settings.cancel') }}</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="settings-footer">
        <button class="settings-save" @click="save">{{ t('settings.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useSettings, DEFAULT_ACTION_KEYBOARD } from '../composables/useSettings'
import { useI18n } from '../composables/useI18n'
import type { ActionKey } from '../composables/useSettings'
import { actionKeyToKeyDef } from '../utils/actionKeyDef'
import { themes } from '../themes'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { settings, saveSettings, applyCurrentTheme } = useSettings()
const { t, themeLabel } = useI18n()

function selectTheme(name: string) {
  settings.theme.preset = name
  applyCurrentTheme()
}

// ── Action Keyboard ─────────────────────────────────────────

const actionRows = computed(() => {
  return (settings.action_keyboard ?? DEFAULT_ACTION_KEYBOARD).rows
})

function previewDef(ri: number, ki: number) {
  const rows = actionRows.value
  const bottom = ri === rows.length - 1
  return actionKeyToKeyDef(rows[ri][ki], bottom ? { bottomIdx: ki } : undefined)
}

function akPreviewSlotStyle(ri: number, ki: number) {
  const d = previewDef(ri, ki)
  return { flexGrow: d.g ?? 1, flexBasis: '0', minWidth: '0' }
}

function previewLabel(key: ActionKey) {
  if (key.special === 'space') return '\u00a0'
  return key.label || '\u00a0'
}

const akSendPreview = computed(() => {
  if (!akEdit.value) return ''
  return escapeForDisplay(akEdit.value.sendRaw)
})

function ensureActionKeyboard() {
  if (!settings.action_keyboard) {
    settings.action_keyboard = JSON.parse(JSON.stringify(DEFAULT_ACTION_KEYBOARD))
  }
}

function addActionRow() {
  ensureActionKeyboard()
  settings.action_keyboard!.rows.push([])
}

function removeActionRow(ri: number) {
  ensureActionKeyboard()
  settings.action_keyboard!.rows.splice(ri, 1)
}

function addActionKey(ri: number) {
  ensureActionKeyboard()
  settings.action_keyboard!.rows[ri].push({ label: 'new', send: '', auto_enter: true })
}

function resolveAutoEnterForEdit(key: ActionKey): boolean {
  if (typeof key.auto_enter === 'boolean') return key.auto_enter
  const s = key.send
  if (!s) return true
  if (s.charCodeAt(0) === 0x1b) return false
  if (s.length === 1) {
    const c = s.charCodeAt(0)
    if (c < 32 || c === 127) return false
  }
  return true
}

function removeActionKey(ri: number, ki: number) {
  ensureActionKeyboard()
  settings.action_keyboard!.rows[ri].splice(ki, 1)
}

const akKeyIds = new WeakMap<ActionKey, string>()

function akItemKey(key: ActionKey) {
  let id = akKeyIds.get(key)
  if (!id) {
    id = `ak-${Math.random().toString(36).slice(2)}`
    akKeyIds.set(key, id)
  }
  return id
}

let akResizePid = -1

function akResizePointerDown(ri: number, ki: number, e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  ensureActionKeyboard()
  const row = settings.action_keyboard!.rows[ri]
  const key = row[ki]
  const startX = e.clientX
  const startGrow = key.grow != null && key.grow > 0 ? key.grow : 1
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  akResizePid = e.pointerId

  const clamp = (v: number) => Math.min(12, Math.max(0.5, Math.round(v * 4) / 4))

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== akResizePid) return
    key.grow = clamp(startGrow + (ev.clientX - startX) / 28)
  }
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== akResizePid) return
    try {
      el.releasePointerCapture(ev.pointerId)
    } catch {}
    akResizePid = -1
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

// Edit modal
const akEdit = ref<{ ri: number; ki: number; label: string; sendRaw: string; style: string; repeat: boolean; auto_enter: boolean } | null>(null)
const akRecording = ref(false)
const recordFocusSinkRef = ref<HTMLElement | null>(null)

function editActionKey(ri: number, ki: number) {
  const key = actionRows.value[ri][ki]
  akEdit.value = {
    ri, ki,
    label: key.label,
    sendRaw: key.send,
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
  }
}

function saveActionKey() {
  if (!akEdit.value) return
  ensureActionKeyboard()
  const { ri, ki, label, sendRaw, style, repeat, auto_enter } = akEdit.value
  const key = settings.action_keyboard!.rows[ri][ki]
  key.label = label
  key.send = sendRaw
  key.style = style || undefined
  key.repeat = repeat || undefined
  key.auto_enter = auto_enter
  akEdit.value = null
}

function resetActionKeyboard() {
  settings.action_keyboard = JSON.parse(JSON.stringify(DEFAULT_ACTION_KEYBOARD))
}

// Key recording
let recordHandler: ((e: KeyboardEvent) => void) | null = null

function toggleRecord() {
  if (akRecording.value) {
    stopRecord()
  } else {
    startRecord()
  }
}

function recordingEventIgnorable(e: KeyboardEvent): boolean {
  if (e.repeat) return true
  const k = e.key
  return k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta'
}

function startRecord() {
  akRecording.value = true
  recordHandler = (e: KeyboardEvent) => {
    if (recordingEventIgnorable(e)) return
    if (!akEdit.value) return
    const seq = keyEventToSequence(e)
    if (!seq) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    akEdit.value.sendRaw = seq
    if (akEdit.value.label === 'new' || akEdit.value.label === '') {
      akEdit.value.label = keyEventToLabel(e)
    }
    stopRecord()
  }
  window.addEventListener('keydown', recordHandler, true)
  nextTick(() => {
    document.querySelector<HTMLElement>('.xterm-helper-textarea')?.blur()
    const ae = document.activeElement
    if (ae instanceof HTMLElement) ae.blur()
    recordFocusSinkRef.value?.focus({ preventScroll: true })
  })
}

function stopRecord() {
  akRecording.value = false
  if (recordHandler) {
    window.removeEventListener('keydown', recordHandler, true)
    recordHandler = null
  }
  recordFocusSinkRef.value?.blur()
}

onBeforeUnmount(() => {
  stopRecord()
})

const FKEY_SEQ: Record<string, string> = {
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
}

function letterFromPhysicalCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return null
}

function keyEventToSequence(e: KeyboardEvent): string {
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  let ch = ''

  const fk = FKEY_SEQ[e.key]
  if (fk) return fk

  if (e.key === 'Escape') ch = '\x1b'
  else if (e.key === 'Tab') ch = e.shiftKey ? '\x1b[Z' : '\t'
  else if (e.key === 'Backspace') ch = '\x7f'
  else if (e.key === 'Enter') ch = '\r'
  else if (e.key === 'ArrowUp') ch = '\x1b[A'
  else if (e.key === 'ArrowDown') ch = '\x1b[B'
  else if (e.key === 'ArrowRight') ch = '\x1b[C'
  else if (e.key === 'ArrowLeft') ch = '\x1b[D'
  else if (e.key === 'Insert') ch = '\x1b[2~'
  else if (e.key === 'Delete') ch = '\x1b[3~'
  else if (e.key === 'Home') ch = '\x1b[H'
  else if (e.key === 'End') ch = '\x1b[F'
  else if (e.key === 'PageUp') ch = '\x1b[5~'
  else if (e.key === 'PageDown') ch = '\x1b[6~'
  else if (e.key.length === 1) {
    ch = e.key
    if (ctrl) {
      const code = ch.toUpperCase().charCodeAt(0) - 64
      if (code >= 1 && code <= 26) return String.fromCharCode(code)
    }
    if (alt) return '\x1b' + ch
    return ch
  } else {
    const phys = letterFromPhysicalCode(e.code)
    if (phys && phys.length === 1) {
      if (ctrl) {
        const code = phys.toUpperCase().charCodeAt(0) - 64
        if (code >= 1 && code <= 26) return String.fromCharCode(code)
      }
      if (alt) return '\x1b' + phys
      return phys
    }
    return ''
  }

  if (alt && ch.length > 0) return '\x1b' + ch
  return ch
}

function keyEventToLabel(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.metaKey) parts.push('cmd')
  if (e.altKey) parts.push('opt')
  if (e.shiftKey) parts.push('shift')

  let key = e.key
  if (key === ' ') key = 'space'
  else if (key === 'Escape') key = 'esc'
  else if (key === 'Backspace') key = '⌫'
  else if (key === 'Tab') key = 'tab'
  else if (key === 'Enter') key = '↵'
  else if (key === 'ArrowUp') key = '↑'
  else if (key === 'ArrowDown') key = '↓'
  else if (key === 'ArrowLeft') key = '←'
  else if (key === 'ArrowRight') key = '→'
  else if (key.length === 1) key = key.toLowerCase()
  else return key

  if (parts.length && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    parts.push(key)
  } else if (!parts.length) {
    return key
  }
  return parts.join('+')
}

function escapeForDisplay(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, c => {
    const code = c.charCodeAt(0)
    if (code === 0x1b) return '\\e'
    if (code === 0x09) return '\\t'
    if (code === 0x0d) return '\\r'
    if (code === 0x0a) return '\\n'
    if (code === 0x7f) return '\\x7f'
    if (code <= 26) return '^' + String.fromCharCode(code + 64)
    return '\\x' + code.toString(16).padStart(2, '0')
  })
}

async function save() {
  await saveSettings()
  emit('close')
}
</script>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 900;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}
.settings-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

.settings-panel {
  position: fixed;
  top: 0;
  bottom: 0;
  right: 0;
  width: min(520px, calc(100vw - 12px));
  max-width: 100%;
  background: var(--bg-surface, #1A1A1A);
  border-left: 1px solid var(--border, #333);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  z-index: 901;
}
.settings-panel.open {
  transform: translateX(0);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #333);
}
.settings-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--fg-bright, #F0F6FC);
}
.settings-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--fg-muted, #666);
}
.settings-close:hover {
  background: rgba(255,255,255,0.1);
  color: var(--fg-bright, #F0F6FC);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.settings-section {
  margin-bottom: 24px;
}
.settings-section h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.theme-card {
  border: 2px solid var(--border, #333);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
  text-align: left;
}
.theme-card.active {
  border-color: var(--accent, #4D7FFF);
}
.theme-card:hover {
  border-color: var(--accent-hover, #6E9AFF);
}
.theme-preview {
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  min-height: 36px;
  display: flex;
  align-items: center;
}
.theme-name {
  display: block;
  padding: 4px 10px 6px;
  font-size: 11px;
  color: var(--fg-muted, #666);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.settings-row label {
  font-size: 13px;
  color: var(--fg, #C7C7C7);
  white-space: nowrap;
}
.settings-row select,
.settings-row input[type="color"] {
  background: var(--bg-input, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: var(--fg, #C7C7C7);
  padding: 4px 8px;
  font-size: 13px;
}
.settings-row input[type="range"] {
  flex: 1;
  accent-color: var(--accent, #4D7FFF);
}
.settings-row input[type="file"] {
  font-size: 12px;
  color: var(--fg-muted, #666);
}

.shortcut-input {
  flex: 1;
  background: var(--bg-input, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: var(--fg, #C7C7C7);
  padding: 4px 8px;
  font-size: 12px;
}
.shortcut-check {
  font-size: 12px;
  color: var(--fg-muted, #666);
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}
.shortcut-del {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  color: var(--fg-muted, #666);
  display: flex;
  align-items: center;
  justify-content: center;
}
.shortcut-del:hover {
  background: rgba(255,100,100,0.2);
  color: #ff6b6b;
}
.shortcut-add {
  font-size: 12px;
  color: var(--accent, #4D7FFF);
  padding: 4px 0;
}

/* ── Action Keyboard Settings ─────────────────────────────── */
.settings-hint {
  font-size: 11px;
  color: var(--fg-muted, #666);
  margin-bottom: 10px;
}

.ak-wysiwyg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px 10px;
  margin-bottom: 10px;
  background: #1c1c1e;
  border: 1px solid #38383a;
  border-radius: 8px;
}

.ak-wysiwyg :deep(.mkb-btn) {
  touch-action: none;
}

.ak-wyg-row-outer {
  display: flex;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
}

.ak-wyg-row-outer .mkb-row-wrap {
  flex: 1;
  min-width: 0;
}

.ak-wyg-chrome {
  pointer-events: none;
  opacity: 0.88;
  flex-shrink: 0;
}

.ak-wyg-slot {
  min-width: 0;
  display: flex;
}

.ak-wyg-key {
  position: relative;
  flex: 1;
  min-width: 0;
  width: 100%;
  padding-right: 20px;
  box-sizing: border-box;
  cursor: default;
}

.ak-wyg-label {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.ak-wyg-label:hover {
  text-decoration: underline;
}

.ak-key-del {
  position: absolute;
  right: 14px;
  top: 2px;
  font-size: 8px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
  z-index: 3;
  padding: 0;
}

.ak-key-del:hover {
  background: rgba(255, 100, 100, 0.35);
  color: #ff6b6b;
}

.ak-key-resize {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: ew-resize;
  touch-action: none;
  border-radius: 0 6px 6px 0;
  background: rgba(255, 255, 255, 0.08);
  z-index: 2;
}

.ak-key-resize:hover {
  background: rgba(77, 127, 255, 0.4);
}

.ak-wyg-add-key {
  flex: 0 0 40px !important;
  width: 40px !important;
  min-width: 40px !important;
  font-size: 18px !important;
  font-weight: 300;
  color: #8e8e93 !important;
}

.ak-wyg-remove-row {
  flex-shrink: 0;
  align-self: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--fg-muted, #666);
  border: 1px solid var(--border, #444);
  background: var(--bg-input, #1a1a1a);
}

.ak-wyg-remove-row:hover {
  background: rgba(255, 100, 100, 0.15);
  color: #ff6b6b;
  border-color: rgba(255, 100, 100, 0.4);
}

.ak-wyg-fixed-cluster {
  pointer-events: none;
  opacity: 0.92;
  margin-top: 2px;
}

.ak-wyg-fixed-cluster .mkb-btn {
  cursor: default;
}

.ak-actions {
  display: flex;
  gap: 12px;
}

.ak-reset {
  color: var(--fg-muted, #666) !important;
}

/* Edit modal */
.ak-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ak-modal {
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 20px;
  width: 300px;
  max-width: 90vw;
}

.ak-modal h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright, #F0F6FC);
  margin-bottom: 12px;
}

.ak-field {
  display: block;
  margin-bottom: 10px;
}
.ak-field > span {
  display: block;
  font-size: 11px;
  color: var(--fg-muted, #666);
  margin-bottom: 4px;
}

.ak-send-textarea {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.35;
}

.ak-send-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 10px;
}

.ak-esc-preview {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: var(--fg-muted, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ak-record-focus-sink {
  position: fixed;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: 0;
  border: 0;
  opacity: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  left: 0;
  top: 0;
  z-index: 1001;
}

.ak-record-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  background: #2c2c2e;
  color: var(--fg, #C7C7C7);
  border: 1px solid var(--border, #333);
}
.ak-record-btn.recording {
  background: #ff3b30;
  color: #fff;
  border-color: #ff3b30;
}

.ak-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.ak-modal-actions .settings-save {
  flex: 1;
}
.ak-modal-actions .shortcut-add {
  flex: 1;
  text-align: center;
}

.settings-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border, #333);
}
.settings-save {
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  background: var(--accent, #4D7FFF);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}
.settings-save:hover {
  background: var(--accent-hover, #6E9AFF);
}
</style>
