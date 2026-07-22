import { ref, nextTick, type Ref } from 'vue'
import type { SettingsData } from './useSettings'
import type { KeyBinding, KeyBindingDef } from './useKeybindings'

type TFunc = (key: string, params?: Record<string, string | number>) => string

export interface KbRecordingOptions {
  defs: KeyBindingDef[]
  settings: SettingsData
  t: TFunc
}

export interface KbRecording {
  kbRecording: Ref<string | null>
  kbRecordError: Ref<string>
  startKbRecord: (id: string) => void
  stopKbRecord: () => void
  resetKbBinding: (id: string) => void
}

export function useKbRecording(opts: KbRecordingOptions): KbRecording {
  const { defs, settings, t } = opts

  const kbRecording = ref<string | null>(null)
  const kbRecordError = ref('')
  let kbRecordHandler: ((e: KeyboardEvent) => void) | null = null

  function startKbRecord(id: string) {
    const def = defs.find((d) => d.id === id)
    const kind = def?.kind ?? 'app'
    kbRecording.value = id
    kbRecordError.value = ''
    kbRecordHandler = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return
      e.preventDefault()
      e.stopPropagation()
      const key = k.toLowerCase()
      if (
        kind === 'terminal' &&
        e.ctrlKey &&
        e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        (key === 'c' || key === 'v')
      ) {
        kbRecordError.value = t('keybinding.terminalReservedError')
        return
      }
      const binding: KeyBinding =
        kind === 'terminal'
          ? {
              key,
              shift: e.shiftKey,
              meta: e.metaKey,
              ctrl: e.ctrlKey,
              alt: e.altKey,
            }
          : { key, shift: e.shiftKey }
      settings.keybindings[id] = binding
      stopKbRecord()
    }
    window.addEventListener('keydown', kbRecordHandler, true)
    nextTick(() => {
      document.querySelector<HTMLElement>('.xterm-helper-textarea')?.blur()
      const ae = document.activeElement
      if (ae instanceof HTMLElement) ae.blur()
    })
  }

  function stopKbRecord() {
    kbRecording.value = null
    kbRecordError.value = ''
    if (kbRecordHandler) {
      window.removeEventListener('keydown', kbRecordHandler, true)
      kbRecordHandler = null
    }
  }

  function resetKbBinding(id: string) {
    delete settings.keybindings[id]
  }

  return {
    kbRecording,
    kbRecordError,
    startKbRecord,
    stopKbRecord,
    resetKbBinding,
  }
}
