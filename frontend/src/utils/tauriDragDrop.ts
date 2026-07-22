let tauriDragDropRegistered = false

// Stores the sendData closure of the last focused terminal instance.
// We deliberately store a function rather than the TerminalInstance to avoid
// a circular import (TerminalInstance imports this module for escapeShellPath
// and setupGlobalTauriDragDrop).
let lastFocusedSendData: ((data: string) => void) | null = null

export function setLastFocusedSendData(fn: ((data: string) => void) | null) {
  lastFocusedSendData = fn
}

export function escapeShellPath(p: string): string {
  return /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
}

export function setupGlobalTauriDragDrop() {
  if (tauriDragDropRegistered) return
  tauriDragDropRegistered = true

  const w = window as any
  const listen = w.__TAURI__?.event?.listen
  if (!listen) return

  listen('file-drop-paths', (event: any) => {
    const payload = event.payload || []
    const paths: string[] = Array.isArray(payload) ? payload : (payload.paths || [])
    if (paths.length > 0 && lastFocusedSendData) {
      const escaped = paths.map(escapeShellPath)
      lastFocusedSendData(escaped.join(' '))
    }
  })
}
