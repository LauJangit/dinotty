import { isTauri, tauriInvoke } from './useTransport'

const STORAGE_KEY = 'dinotty_auth_token'

let cached = ''
let inflight: Promise<string> | null = null

export function getAuthToken(): string {
  // localStorage takes priority (persists across "Add to Home Screen" opens)
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored

  // Fallback to meta tag (set when accessing via ?token=xxx)
  return document.querySelector('meta[name="auth-token"]')?.getAttribute('content') || ''
}

export function setAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
  // Also update the meta tag so other code paths pick it up immediately
  let meta = document.querySelector('meta[name="auth-token"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'auth-token')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasAuthToken(): boolean {
  return !!(
    localStorage.getItem(STORAGE_KEY) ||
    document.querySelector('meta[name="auth-token"]')?.getAttribute('content')
  )
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/auth'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
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
  const headers = new Headers(init?.headers)
  Object.entries(authHeaders()).forEach(([key, value]) => headers.set(key, value))
  return fetch(url, { ...init, headers })
}

export function wsUrlWithToken(url: string): string {
  const token = getAuthToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}
