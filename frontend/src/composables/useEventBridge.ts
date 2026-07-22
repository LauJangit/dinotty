import { onEvent, getClientId } from './useSyncWebSocket'
import { authFetch, apiUrl } from './apiBase'
import type { SyncEvent } from '../types/protocol'

export type EventHandler<T = unknown> = (data: T, e: SyncEvent) => void

type HandlerEntry = {
  handler: EventHandler
  pluginId?: string
}

const handlers = new Map<string, Set<HandlerEntry>>()

// Register a single onEvent listener at module load; dispatches to matching handlers.
onEvent((e) => {
  const set = handlers.get(e.event_name)
  if (!set) return
  for (const entry of set) {
    // If the event carries a target_plugin_id, only trigger the matching plugin's handler.
    if (e.target_plugin_id && entry.pluginId !== e.target_plugin_id) continue
    entry.handler(e.data, e)
  }
})

export function subscribe<T = unknown>(
  eventName: string,
  handler: EventHandler<T>,
  opts?: { pluginId?: string },
): () => void {
  const entry: HandlerEntry = { handler: handler as EventHandler, pluginId: opts?.pluginId }
  let set = handlers.get(eventName)
  if (!set) {
    set = new Set()
    handlers.set(eventName, set)
  }
  set.add(entry)
  return () => {
    set?.delete(entry)
    if (set && set.size === 0) handlers.delete(eventName)
  }
}

export function emit(
  eventName: string,
  data: unknown,
  opts?: { source_pane_id?: string; plugin_id?: string; target_plugin_id?: string },
): void {
  void authFetch(apiUrl('/api/events/emit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_name: eventName,
      data,
      source_pane_id: opts?.source_pane_id,
      plugin_id: opts?.plugin_id,
      target_plugin_id: opts?.target_plugin_id,
      client_id: getClientId(),
    }),
  })
}

if (import.meta.env.DEV) {
  ;(window as any).__dinotty_eventBridge = { subscribe, emit }
}
