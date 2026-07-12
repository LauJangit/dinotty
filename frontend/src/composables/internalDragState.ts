/**
 * Shared state for tracking internal tree drags in Tauri.
 * Separate module to avoid circular deps between TreeRows and useFileOperations.
 */

let _active = false
let _rel: string | null = null

export function setInternalDrag(rel: string) {
  _active = true
  _rel = rel
}

export function clearInternalDrag() {
  _active = false
  _rel = null
}

export function isInternalDragActive() {
  return _active
}

export function getInternalDragRel() {
  return _rel
}
