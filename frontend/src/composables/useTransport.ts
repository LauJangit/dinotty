import type { ClientMsg, ServerMsg } from '../types/protocol'
import { wsUrlWithToken } from './apiBase'

export interface Transport {
  send(msg: ClientMsg): void
  onMessage(handler: (msg: ServerMsg) => void): void
  onConnect(handler: () => void): void
  onDisconnect(handler: () => void): void
  disconnect(): void
}

export function isTauri(): boolean {
  const w = window as any
  return !!(w.__TAURI_INTERNALS__?.invoke || w.__TAURI__?.core?.invoke)
}

export function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const tauri = (window as any).__TAURI__
  const invoke =
    tauri?.core?.invoke ??
    ((c: string, a?: object) => (window as any).__TAURI_INTERNALS__.invoke(c, a ?? {}))
  return invoke(cmd, args ?? {})
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _destroyed = false
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private paneId: string,
    private host?: string
  ) {
    this._connect()
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  onMessage(handler: (msg: ServerMsg) => void) {
    this._messageHandler = handler
  }

  onConnect(handler: () => void) {
    this._connectHandler = handler
  }

  onDisconnect(handler: () => void) {
    this._disconnectHandler = handler
  }

  disconnect() {
    this._destroyed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this.ws) {
      this.ws.close(1000)
      this.ws = null
    }
  }

  private _connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = this.host || location.host
    const url = wsUrlWithToken(`${proto}//${host}/ws?paneId=${encodeURIComponent(this.paneId)}`)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectAttempts = 0
      this._connectHandler?.()
    }

    this.ws.onmessage = (e) => {
      try {
        const msg: ServerMsg = JSON.parse(e.data)
        this._messageHandler?.(msg)
      } catch {}
    }

    this.ws.onclose = (e) => {
      if (this._destroyed) return
      this._disconnectHandler?.()
      if (e.code !== 1000) {
        this._scheduleReconnect()
      }
    }

    this.ws.onerror = () => {}
  }

  private _scheduleReconnect() {
    if (this._destroyed) return
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000)
    this._reconnectAttempts++
    this._reconnectTimer = setTimeout(() => this._connect(), delay)
  }
}

export class TauriIpcTransport implements Transport {
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _unlistenFns: Array<() => void> = []

  constructor(private paneId: string) {
    this._init()
  }

  private _invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    return tauriInvoke(cmd, { paneId: this.paneId, ...args })
  }

  private async _init() {
    const tauri = (window as any).__TAURI__
    const listen = tauri?.event?.listen
    if (!listen) {
      console.error('Tauri event API missing; enable app.withGlobalTauri in tauri.conf.json')
      this._disconnectHandler?.()
      return
    }

    this._unlistenFns.push(
      await listen('pty-output', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'output', data: e.payload.data })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-reconnected', (e: any) => {
        const p = e.payload
        if (p.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'reconnected', cols: p.cols, rows: p.rows })
        }
      })
    )
    this._unlistenFns.push(
      await listen('pty-exit', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._disconnectHandler?.()
        }
      })
    )

    try {
      const shellType: string = (await this._invoke('pty_spawn')) as string
      this._connectHandler?.()
      this._messageHandler?.({ type: 'shell_info', shell_type: shellType })
    } catch (e) {
      console.error('pty_spawn failed:', e)
      this._disconnectHandler?.()
    }
  }

  send(msg: ClientMsg) {
    if (msg.type === 'input') {
      this._invoke('pty_write', { data: msg.data }).catch((err: unknown) => {
        const errStr = typeof err === 'string' ? err : String(err)
        if (errStr.includes('timeout') || errStr.includes('exited')) {
          this._disconnectHandler?.()
        }
      })
    } else if (msg.type === 'resize') {
      this._invoke('pty_resize', { cols: msg.cols, rows: msg.rows }).catch(() => {})
    }
  }

  onMessage(handler: (msg: ServerMsg) => void) {
    this._messageHandler = handler
  }

  onConnect(handler: () => void) {
    this._connectHandler = handler
  }

  onDisconnect(handler: () => void) {
    this._disconnectHandler = handler
  }

  disconnect() {
    this._invoke('pty_detach')
    for (const u of this._unlistenFns) {
      u()
    }
    this._unlistenFns = []
  }
}

export class HttpTransport implements Transport {
  private _eventSource: EventSource | null = null
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _destroyed = false
  private _paneId: string
  private _baseUrl: string

  constructor(paneId: string, host?: string) {
    this._paneId = paneId
    this._baseUrl = host ? `${location.protocol}//${host}` : ''
    this._connect()
  }

  private _connect() {
    const url = `${this._baseUrl}/http/term?paneId=${encodeURIComponent(this._paneId)}`
    this._eventSource = new EventSource(url)

    this._eventSource.onopen = () => {
      this._connectHandler?.()
    }

    this._eventSource.onmessage = (e) => {
      try {
        const msg: ServerMsg = JSON.parse(e.data)
        this._messageHandler?.(msg)
      } catch {}
    }

    this._eventSource.onerror = () => {
      // EventSource auto-reconnects natively
    }
  }

  send(msg: ClientMsg) {
    if (this._destroyed) return
    if (msg.type === 'input') {
      fetch(`${this._baseUrl}/http/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pane_id: this._paneId, data: msg.data }),
      }).catch(() => {})
    } else if (msg.type === 'resize') {
      fetch(`${this._baseUrl}/http/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pane_id: this._paneId, cols: msg.cols, rows: msg.rows }),
      }).catch(() => {})
    }
  }

  onMessage(handler: (msg: ServerMsg) => void) {
    this._messageHandler = handler
  }

  onConnect(handler: () => void) {
    this._connectHandler = handler
  }

  onDisconnect(handler: () => void) {
    this._disconnectHandler = handler
  }

  disconnect() {
    this._destroyed = true
    this._eventSource?.close()
    this._eventSource = null
  }
}

export class WebSocketWithFallbackTransport implements Transport {
  private _active: Transport
  private _ws: WebSocketTransport
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private _fellBack = false

  constructor(paneId: string, host?: string) {
    this._ws = new WebSocketTransport(paneId, host)
    this._active = this._ws

    // If WS doesn't connect within 3 seconds, fall back to HTTP
    this._fallbackTimer = setTimeout(() => {
      if (!this._fellBack) {
        this._switchToHttp(paneId, host)
      }
    }, 3000)

    this._ws.onConnect(() => {
      if (this._fallbackTimer) {
        clearTimeout(this._fallbackTimer)
        this._fallbackTimer = null
      }
      this._connectHandler?.()
    })

    this._ws.onDisconnect(() => {
      // If WS fails before connecting (e.g. 401 from auth), switch to HTTP immediately
      if (!this._fellBack && this._fallbackTimer) {
        clearTimeout(this._fallbackTimer)
        this._fallbackTimer = null
        this._switchToHttp(paneId, host)
        return
      }
      this._disconnectHandler?.()
    })

    this._ws.onMessage((msg) => {
      this._messageHandler?.(msg)
    })
  }

  private _switchToHttp(paneId: string, host?: string) {
    this._fellBack = true
    this._ws.disconnect()
    console.log('[transport] WebSocket failed, falling back to HTTP transport')
    const http = new HttpTransport(paneId, host)
    this._active = http
    if (this._messageHandler) http.onMessage(this._messageHandler)
    if (this._connectHandler) http.onConnect(this._connectHandler)
    if (this._disconnectHandler) http.onDisconnect(this._disconnectHandler)
  }

  send(msg: ClientMsg) {
    this._active.send(msg)
  }

  onMessage(handler: (msg: ServerMsg) => void) {
    this._messageHandler = handler
    this._active.onMessage(handler)
  }

  onConnect(handler: () => void) {
    this._connectHandler = handler
    this._active.onConnect(handler)
  }

  onDisconnect(handler: () => void) {
    this._disconnectHandler = handler
    this._active.onDisconnect(handler)
  }

  disconnect() {
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer)
      this._fallbackTimer = null
    }
    this._active.disconnect()
  }
}

export function createTransport(paneId: string, host?: string): Transport {
  if (isTauri()) {
    return new TauriIpcTransport(paneId)
  }
  return new WebSocketWithFallbackTransport(paneId, host)
}
