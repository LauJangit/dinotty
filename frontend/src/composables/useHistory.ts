import { ref } from 'vue'
import { apiUrl, authFetch, wsUrlWithToken } from './apiBase'

declare function tauriInvoke(cmd: string): Promise<unknown>

export interface SuggestionItem {
  command: string
  frequency: number
}

const suggestions = ref<SuggestionItem[]>([])
let fetchTimer: ReturnType<typeof setTimeout> | null = null
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

async function connectWs() {
  if (ws && ws.readyState <= WebSocket.OPEN) return

  let url: string
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    const origin = String(
      await (window as any).__TAURI__.core.invoke('embedded_http_origin')
    ).replace(/\/$/, '')
    url = `${origin.replace(/^http/, 'ws')}/ws/history`
  } else {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url = `${proto}//${location.host}/ws/history`
  }

  ws = new WebSocket(wsUrlWithToken(url))

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'suggestions' && Array.isArray(msg.items)) {
        suggestions.value = msg.items
      }
    } catch {}
  }

  ws.onclose = () => {
    ws = null
    reconnectTimer = setTimeout(connectWs, 3000)
  }

  ws.onerror = () => {
    ws?.close()
  }
}

export function useHistory() {
  connectWs()

  async function fetchSuggestions(prefix?: string) {
    const params = new URLSearchParams()
    if (prefix) params.set('prefix', prefix)
    params.set('limit', '20')

    try {
      const res = await authFetch(apiUrl(`/api/history?${params}`))
      if (res.ok) {
        suggestions.value = await res.json()
      }
    } catch {
      // ignore
    }
  }

  function fetchDebounced(prefix?: string) {
    if (fetchTimer) clearTimeout(fetchTimer)
    fetchTimer = setTimeout(() => fetchSuggestions(prefix), 150)
  }

  async function deleteSuggestion(command: string) {
    try {
      await authFetch(apiUrl('/api/history'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      suggestions.value = suggestions.value.filter((s) => s.command !== command)
    } catch {
      // ignore
    }
  }

  return { suggestions, fetchSuggestions, fetchDebounced, deleteSuggestion }
}
