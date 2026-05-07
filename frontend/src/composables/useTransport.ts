import type { ClientMsg, ServerMsg } from '../types/protocol'

export interface Transport {
  send(msg: ClientMsg): void
  onMessage(handler: (msg: ServerMsg) => void): void
  onConnect(handler: () => void): void
  onDisconnect(handler: () => void): void
  disconnect(): void
}

export function isTauri(): boolean {
  return !!(window as any).__TAURI__
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private _messageHandler: ((msg: ServerMsg) => void) | null = null
  private _connectHandler: (() => void) | null = null
  private _disconnectHandler: (() => void) | null = null
  private _destroyed = false
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private paneId: string, private host?: string) {
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
    const url = `${proto}//${host}/ws?paneId=${encodeURIComponent(this.paneId)}`
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

  private async _init() {
    const { invoke, event } = (window as any).__TAURI__

    this._unlistenFns.push(
      await event.listen('pty-output', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'output', data: e.payload.data })
        }
      }),
    )
    this._unlistenFns.push(
      await event.listen('pty-reconnected', (e: any) => {
        const p = e.payload
        if (p.pane_id === this.paneId) {
          this._messageHandler?.({ type: 'reconnected', cols: p.cols, rows: p.rows })
        }
      }),
    )
    this._unlistenFns.push(
      await event.listen('pty-exit', (e: any) => {
        if (e.payload.pane_id === this.paneId) {
          this._disconnectHandler?.()
        }
      }),
    )

    try {
      const shellType: string = await invoke('pty_spawn', { paneId: this.paneId })
      this._connectHandler?.()
      this._messageHandler?.({ type: 'shell_info', shell_type: shellType })
    } catch (e) {
      console.error('pty_spawn failed:', e)
      this._disconnectHandler?.()
    }
  }

  send(msg: ClientMsg) {
    const { invoke } = (window as any).__TAURI__
    if (msg.type === 'input') {
      invoke('pty_write', { paneId: this.paneId, data: msg.data })
    } else if (msg.type === 'resize') {
      invoke('pty_resize', { paneId: this.paneId, cols: msg.cols, rows: msg.rows })
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
    const { invoke } = (window as any).__TAURI__
    invoke('pty_kill', { paneId: this.paneId })
    for (const u of this._unlistenFns) {
      u()
    }
    this._unlistenFns = []
  }
}

export function createTransport(paneId: string, host?: string): Transport {
  if (isTauri()) {
    return new TauriIpcTransport(paneId)
  }
  return new WebSocketTransport(paneId, host)
}
