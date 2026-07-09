import { isTauri, tauriInvoke } from './useTransport'

const STORAGE_KEY = 'dinotty_auth_token'

// Browser mode: cookie-based session (no token in localStorage).
// Tauri mode: Bearer token in localStorage (tauri_fetch has no cookie jar).
let loggedIn = false

let cached = ''
let inflight: Promise<string> | null = null

export function getAuthToken(): string {
  if (!isTauri()) return loggedIn ? 'cookie' : ''
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored || ''
}

export function setAuthToken(token: string): void {
  if (!isTauri()) {
    loggedIn = true
    return
  }
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearAuthToken(): void {
  if (!isTauri()) {
    loggedIn = false
    return
  }
  localStorage.removeItem(STORAGE_KEY)
}

export function hasAuthToken(): boolean {
  if (!isTauri()) return loggedIn
  return !!localStorage.getItem(STORAGE_KEY)
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    const res = await fetch(apiUrl('/api/auth'), init)
    if (res.ok) {
      if (!isTauri()) loggedIn = true
      return true
    }
    return false
  } catch {
    return false
  }
}

export async function checkTokenConfigured(): Promise<{
  configured: boolean
  serverMode: boolean
}> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/token-configured'))
    if (!res.ok) return { configured: true, serverMode: true }
    const data = await res.json()
    return { configured: !!data.configured, serverMode: !!data.server_mode }
  } catch {
    return { configured: true, serverMode: true }
  }
}

export async function fetchAutoToken(): Promise<string> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/auto-token'))
    if (!res.ok) return ''
    const data = await res.json()
    return data.token || ''
  } catch {
    return ''
  }
}

export async function fetchServerToken(): Promise<string> {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/token'))
    if (!res.ok) return ''
    const data = await res.json()
    return data.token || ''
  } catch {
    return ''
  }
}

export async function getApiBase(): Promise<string> {
  if (!isTauri()) {
    cached = ''
    return ''
  }
  if (cached) return cached
  if (!inflight) {
    inflight = tauriInvoke('embedded_http_origin')
      .then((o) => {
        const s = String(o).replace(/\/$/, '')
        cached = s
        return s
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return cached ? `${cached}${p}` : p
}

export function authHeaders(): Record<string, string> {
  if (!isTauri()) return {}
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    if (init?.body != null && typeof init.body !== 'string') {
      return new Response('desktop bridge does not support binary/multipart body', { status: 400 })
    }
    const headers = Object.entries(authHeaders())
    if (init?.headers) {
      const h = new Headers(init.headers)
      h.forEach((v, k) => headers.push([k, v]))
    }
    const resp = (await tauriInvoke('tauri_fetch', {
      url,
      method: init?.method || 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    })) as { status: number; headers: [string, string][]; body: string }
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    })
  }
  return fetch(url, { ...init, credentials: 'include' })
}

export function wsUrlWithToken(url: string): string {
  // Browser: same-origin WS sends cookies automatically.
  // Tauri: loopback bypass or Bearer in WS URL is not needed.
  return url
}
