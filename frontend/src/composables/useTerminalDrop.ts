import { isTauri } from './useTransport'
import {
  escapeShellPath,
  setLastFocusedSendData,
  setupGlobalTauriDragDrop,
} from '../utils/tauriDragDrop'

export interface DropHost {
  sendData(data: string): void
  onFileUpload?(files: File[]): void
}

/**
 * Wires HTML5 drag/drop, the custom `terminal-drop-path` event (Tauri), the
 * Tauri focus-tracking for global file-drop-paths, and clipboard-paste
 * upload. Returns a single cleanup function that tears all of it down.
 */
export function setupTerminalDrop(
  wrapper: HTMLElement,
  host: DropHost
): () => void {
  const cleanups: Array<() => void> = []

  if (isTauri()) {
    setLastFocusedSendData((d) => host.sendData(d))
    const focusinHandler = () => {
      setLastFocusedSendData((d) => host.sendData(d))
    }
    wrapper.addEventListener('focusin', focusinHandler)
    cleanups.push(() => {
      wrapper.removeEventListener('focusin', focusinHandler)
      setLastFocusedSendData(null)
    })
    setupGlobalTauriDragDrop()
  }

  // Custom 'terminal-drop-path' dispatched by the file tree when Tauri's
  // native layer intercepts HTML5 drop events.
  const dropPathHandler = ((e: CustomEvent) => {
    const path = e.detail?.path as string
    if (!path) return
    host.sendData(escapeShellPath(path))
  }) as EventListener
  wrapper.addEventListener('terminal-drop-path', dropPathHandler)
  cleanups.push(() => wrapper.removeEventListener('terminal-drop-path', dropPathHandler))

  const xtermEl = wrapper.querySelector('.xterm') as HTMLElement
  const target = xtermEl || wrapper

  const dragoverHandler = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e as DragEvent).dataTransfer!.dropEffect = 'copy'
  }
  target.addEventListener('dragover', dragoverHandler, true)
  cleanups.push(() => target.removeEventListener('dragover', dragoverHandler, true))

  const dropHandler = (e: Event) => {
    const de = e as DragEvent
    const dt = de.dataTransfer!
    if (!isTauri() && (dt.files?.length ?? 0) > 0) {
      e.preventDefault()
      e.stopPropagation()
      host.onFileUpload?.([...dt.files])
      return
    }

    de.preventDefault()
    de.stopPropagation()
    const types = Array.from(dt.types)
    const paths: string[] = []

    if (types.includes('text/uri-list')) {
      const uriList = dt.getData('text/uri-list')
      uriList.split('\n').forEach((u) => {
        u = u.trim()
        if (!u || u.startsWith('#')) return
        try {
          paths.push(decodeURIComponent(new URL(u).pathname))
        } catch {}
      })
    }

    if (paths.length === 0 && types.includes('text/plain')) {
      const text = dt.getData('text/plain').trim()
      const absPlain =
        text && (text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\'))
      if (absPlain) {
        text.split('\n').forEach((l) => {
          if (l.trim()) paths.push(l.trim())
        })
      }
    }

    if (paths.length === 0 && dt.files.length > 0) {
      Array.from(dt.files).forEach((f: any) => {
        if (f.path) paths.push(f.path)
        else if (f.name) paths.push(f.name)
      })
    }

    if (paths.length > 0) {
      host.sendData(paths.map(escapeShellPath).join(' '))
    }
  }
  target.addEventListener('drop', dropHandler, true)
  cleanups.push(() => target.removeEventListener('drop', dropHandler, true))

  // ── Paste upload ────────────────────────────────────────────
  let suppressPasteUpload = false
  let torn = false

  const pasteHandler = (e: ClipboardEvent) => {
    if (suppressPasteUpload) return
    if (isTauri()) return
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    host.onFileUpload?.(files)
  }
  target.addEventListener('paste', pasteHandler, true)

  const keydownHandler = (e: KeyboardEvent) => {
    if (isTauri()) return
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return
    const readClipboard = navigator.clipboard?.read
    if (!readClipboard) return
    suppressPasteUpload = true
    setTimeout(() => {
      suppressPasteUpload = false
    }, 0)

    void readClipboard
      .call(navigator.clipboard)
      .then(async (items) => {
        const files = await Promise.all(
          items.flatMap((item) => {
            const type = item.types.find((itemType) => itemType.startsWith('image/'))
            if (!type) return []
            return [
              item.getType(type).then((blob) => {
                const ext = type.split('/')[1]?.split('+')[0] || 'png'
                return new File([blob], `pasted-image-${Date.now()}.${ext}`, { type })
              }),
            ]
          })
        )
        if (!torn && files.length) host.onFileUpload?.(files)
      })
      .catch(() => {
        // Clipboard image reads may be denied; keep normal text paste behavior intact.
      })
  }
  target.addEventListener('keydown', keydownHandler, true)

  cleanups.push(() => {
    torn = true
    target.removeEventListener('paste', pasteHandler, true)
    target.removeEventListener('keydown', keydownHandler, true)
  })

  return () => {
    for (const fn of cleanups) fn()
  }
}
