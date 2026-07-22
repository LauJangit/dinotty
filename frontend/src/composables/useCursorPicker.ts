import { ref } from 'vue'
import type { Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import { getActiveLeaf, getEditor } from './useEditorRegistry'
import { useCursorGroup, type SearchMatch, type PickerItem } from './useCursorGroup'

export interface CursorPickerOptions {
  tabs: Ref<Array<{ paneId: string; type: string; activePaneId?: string }>>
  activePaneId: Ref<string | null>
  toast: ReturnType<typeof import('vue-toastification').useToast>
  t: (key: string) => string
}

export interface CursorPicker {
  cursorPickerVisible: Ref<boolean>
  cursorPickerItems: Ref<PickerItem[]>
  cursorPickerMatches: Ref<Map<string, SearchMatch>>
  triggerAddCursors: () => Promise<void>
  onCursorPickerConfirm: (selectedIds: string[]) => Promise<void>
}

export function useCursorPicker(opts: CursorPickerOptions): CursorPicker {
  const { tabs, activePaneId, toast, t } = opts

  const cursorPickerVisible = ref(false)
  const cursorPickerItems = ref<PickerItem[]>([])
  const cursorPickerMatches = ref<Map<string, SearchMatch>>(new Map())
  const cursorGroupApi = useCursorGroup()

  async function triggerAddCursors(): Promise<void> {
    const leafId = getActiveLeaf()
    if (!leafId) return
    const editor = getEditor(leafId)
    if (!editor) return
    const selection = editor.getSelection()
    const model = editor.getModel()
    let query = ''
    if (selection && !selection.isEmpty() && model) {
      query = model.getValueInRange(selection)
    } else {
      const pos = editor.getPosition()
      if (pos && model) {
        const word = model.getWordAtPosition(pos)
        if (word) {
          query = model.getValueInRange({
            startLineNumber: pos.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: pos.lineNumber,
            endColumn: word.endColumn,
          })
        }
      }
    }
    if (!query) return

    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    const paneId = tab?.type === 'terminal' ? tab.activePaneId : null
    if (!paneId) return

    try {
      await getApiBase()
      const res = await authFetch(apiUrl('/api/workspace/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pane_id: paneId, path: '.', query }),
      })
      if (res.status === 502) {
        const j = await res.json().catch(() => ({}))
        const message = j.error ? t('errors.rgNotInstalled') : t('errors.rgNotInstalled')
        toast.error(message)
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error || `search failed (${res.status})`)
        return
      }
      const data = await res.json()
      const matches: SearchMatch[] = data.matches ?? []
      if (matches.length === 0) {
        toast.info(t('multiSelect.empty'))
        return
      }

      const matchMap = new Map<string, SearchMatch>()
      cursorPickerItems.value = matches.map((m, i) => {
        const id = `${m.filePath}:${m.line}:${m.column}:${i}`
        matchMap.set(id, m)
        return {
          id,
          label: `${m.filePath}:${m.line}`,
          detail: m.lineText.trim().slice(0, 100),
        }
      })
      cursorPickerMatches.value = matchMap
      cursorPickerVisible.value = true
    } catch (err) {
      toast.error(`search error: ${(err as Error).message}`)
    }
  }

  async function onCursorPickerConfirm(selectedIds: string[]): Promise<void> {
    cursorPickerVisible.value = false
    const matches: SearchMatch[] = []
    for (const id of selectedIds) {
      const m = cursorPickerMatches.value.get(id)
      if (m) matches.push(m)
    }
    if (matches.length === 0) return
    try {
      await cursorGroupApi.createGroupFromSearch(matches)
    } catch (err) {
      toast.error(`create group failed: ${(err as Error).message}`)
    }
  }

  return {
    cursorPickerVisible,
    cursorPickerItems,
    cursorPickerMatches,
    triggerAddCursors,
    onCursorPickerConfirm,
  }
}
