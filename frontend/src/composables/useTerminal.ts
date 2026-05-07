import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ClientMsg, ServerMsg } from '../types/protocol'
import { isTauri, createTransport, type Transport } from './useTransport'

export class TerminalInstance {
  paneId: string
  xterm: XTerm | null = null
  fitAddon: FitAddon | null = null
  ws: WebSocket | null = null
  private _transport: Transport | null = null

  private _wrapper: HTMLElement | null = null
  private _destroyed = false
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _onDataRegistered = false
  private _overlay: HTMLElement | null = null
  private _suppressTitleChange = false
  private _touchCleanup: (() => void) | null = null
  private _resizeObserver: ResizeObserver | null = null

  onTitleChange: ((title: string) => void) | null = null
  onShellInfo: ((shell: string) => void) | null = null
  onConnect: (() => void) | null = null
  onDisconnect: (() => void) | null = null
  onFileClick: ((path: string) => void) | null = null
  onPreviewLink: ((url: string) => void) | null = null

  constructor(paneId: string) {
    this.paneId = paneId
  }

  attach(wrapper: HTMLElement) {
    this._wrapper = wrapper

    const s = getComputedStyle(document.documentElement)
    const v = (name: string) => s.getPropertyValue(name).trim()

    this.xterm = new XTerm({
      cursorBlink: true,
      scrollback: 10000,
      fontSize: 14,
      fontFamily: v('--font-mono'),
      allowProposedApi: true,
      theme: {
        background: v('--bg') || '#1A1A1A',
        foreground: v('--fg') || '#C7C7C7',
        cursor: v('--fg-muted') || '#666666',
        cursorAccent: v('--color-black') || '#000000',
        selectionBackground: 'rgba(77,127,255,0.35)',
        black: v('--color-black') || '#000000',
        red: v('--color-red') || '#C91B00',
        green: v('--color-green') || '#00C200',
        yellow: v('--color-yellow') || '#C7C400',
        blue: v('--color-blue') || '#0225C7',
        magenta: v('--color-magenta') || '#CA30C7',
        cyan: v('--color-cyan') || '#00C5C7',
        white: v('--color-white') || '#C7C7C7',
        brightBlack: v('--color-bright-black') || '#686868',
        brightRed: v('--color-bright-red') || '#FF6E67',
        brightGreen: v('--color-bright-green') || '#5FFA68',
        brightYellow: v('--color-bright-yellow') || '#FFFC67',
        brightBlue: v('--color-bright-blue') || '#6871FF',
        brightMagenta: v('--color-bright-magenta') || '#FF77FF',
        brightCyan: v('--color-bright-cyan') || '#60FDFF',
        brightWhite: v('--color-bright-white') || '#FFFFFF',
      },
    })

    this.fitAddon = new FitAddon()
    this.xterm.loadAddon(this.fitAddon)

    this.xterm.open(wrapper)

    // Register file path link provider
    this.xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
        const line = this.xterm!.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const regex = /(?:^|\s)((?:\/|\.\/|~\/)[^\s:]+)/g
        const links: any[] = []
        let match
        while ((match = regex.exec(text)) !== null) {
          const path = match[1]
          const startX = match.index + (match[0].length - match[1].length)
          links.push({
            range: { start: { x: startX + 1, y: bufferLineNumber }, end: { x: startX + path.length + 1, y: bufferLineNumber } },
            text: path,
            activate: () => { this.onFileClick?.(path) },
          })
        }
        callback(links.length > 0 ? links : undefined)
      },
    })

    // Register URL link provider (localhost → preview, others → new tab)
    this.xterm.registerLinkProvider({
      provideLinks: (bufferLineNumber: number, callback: (links: any[] | undefined) => void) => {
        const line = this.xterm!.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const regex = /(?:https?:\/\/[^\s"'<>]+|(?:www\.)[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s"'<>]*)?)/g
        const links: any[] = []
        let match
        while ((match = regex.exec(text)) !== null) {
          const raw = match[0]
          const uri = raw.startsWith('http') ? raw : `http://${raw}`
          const startX = match.index
          links.push({
            range: { start: { x: startX + 1, y: bufferLineNumber }, end: { x: startX + raw.length + 1, y: bufferLineNumber } },
            text: uri,
            activate: () => {
              if (this.onPreviewLink) {
                this.onPreviewLink(uri)
              } else {
                window.open(uri, '_blank')
              }
            },
          })
        }
        callback(links.length > 0 ? links : undefined)
      },
    })

    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.fitAddon?.fit())
    })

    this.xterm.onTitleChange((title) => {
      if (this._suppressTitleChange) return
      this.onTitleChange?.(title)
    })

    if (isTauri()) {
      this._connectViaTransport()
    } else {
      this._connectWS()
    }
    this._setupDragDrop(wrapper)
    this._setupTouchScroll(wrapper)

    this._resizeObserver = new ResizeObserver(() => this._refit())
    this._resizeObserver.observe(wrapper)
  }

  focus() {
    this.xterm?.focus()
  }

  fit() {
    this._refit()
  }

  sendData(data: string) {
    if (this._transport) {
      this._transport.send({ type: 'input', data })
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data } as ClientMsg))
    }
  }

  destroy() {
    this._destroyed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this._resizeObserver?.disconnect()
    this._touchCleanup?.()
    if (this._transport) {
      this._transport.disconnect()
      this._transport = null
    }
    if (this.ws) {
      this.ws.close(1000)
      this.ws = null
    }
    this.xterm?.dispose()
    this.xterm = null
  }

  private _connectViaTransport() {
    this._transport = createTransport(this.paneId)

    this._transport.onConnect(() => {
      this.onConnect?.()
      this._refit()
    })

    this._transport.onMessage((msg) => {
      if (msg.type === 'output') {
        this.xterm!.write(msg.data)
      } else if (msg.type === 'shell_info') {
        this.onShellInfo?.(msg.shell_type)
      } else if (msg.type === 'reconnected') {
        this._suppressTitleChange = true
        this.xterm!.reset()
        this._suppressTitleChange = false
      }
    })

    this._transport.onDisconnect(() => {
      this.onDisconnect?.()
    })

    this.xterm!.onData((data) => {
      this._transport?.send({ type: 'input', data })
    })
  }

  // ── Private ──────────────────────────────────────────────

  private _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/ws?paneId=${encodeURIComponent(this.paneId)}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectAttempts = 0
      this._hideOverlay()
      this.onConnect?.()
      this._refit()
    }

    this.ws.onmessage = (e) => {
      let msg: ServerMsg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.type === 'reconnected') {
        this._suppressTitleChange = true
        this.xterm!.reset()
        this._suppressTitleChange = false
        this._reconnectAttempts = 0
        this._hideOverlay()
      } else if (msg.type === 'output') {
        this.xterm!.write(msg.data)
      } else if (msg.type === 'shell_info') {
        this.onShellInfo?.(msg.shell_type)
      }
    }

    this.ws.onclose = (e) => {
      if (this._destroyed) return
      this.onDisconnect?.()
      if (e.code === 1000) {
        this.xterm?.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n')
      } else {
        this._scheduleReconnect()
      }
    }

    this.ws.onerror = () => {}

    if (!this._onDataRegistered) {
      this._onDataRegistered = true
      this.xterm!.onData((data) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data } as ClientMsg))
        }
      })
    }
  }

  private _scheduleReconnect() {
    if (this._destroyed) return
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000)
    this._reconnectAttempts++
    this._showOverlay()
    this._reconnectTimer = setTimeout(() => this._connectWS(), delay)
  }

  private _showOverlay() {
    if (!this._wrapper || this._overlay) return
    this._overlay = document.createElement('div')
    this._overlay.className = 'reconnect-overlay'
    this._overlay.textContent = 'Connection lost. Reconnecting...'
    this._wrapper.style.position = 'relative'
    this._wrapper.appendChild(this._overlay)
  }

  private _hideOverlay() {
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
  }

  _refit() {
    if (!this.fitAddon || !this._wrapper) return
    this.fitAddon.fit()
    const resizeMsg: ClientMsg = {
      type: 'resize',
      cols: this.xterm!.cols,
      rows: this.xterm!.rows,
    }
    if (this._transport) {
      this._transport.send(resizeMsg)
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(resizeMsg))
    }
  }

  private _setupDragDrop(wrapper: HTMLElement) {
    const xtermEl = wrapper.querySelector('.xterm') as HTMLElement
    const target = xtermEl || wrapper

    target.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as DragEvent).dataTransfer!.dropEffect = 'copy'
    }, true)

    target.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent
      de.preventDefault()
      de.stopPropagation()

      const dt = de.dataTransfer!
      const types = Array.from(dt.types)
      const paths: string[] = []

      if (types.includes('text/uri-list')) {
        const uriList = dt.getData('text/uri-list')
        uriList.split('\n').forEach((u) => {
          u = u.trim()
          if (!u || u.startsWith('#')) return
          try { paths.push(decodeURIComponent(new URL(u).pathname)) } catch {}
        })
      }

      if (paths.length === 0 && types.includes('text/plain')) {
        const text = dt.getData('text/plain').trim()
        if (text && text.startsWith('/')) {
          text.split('\n').forEach((l) => { if (l.trim()) paths.push(l.trim()) })
        }
      }

      if (paths.length === 0 && dt.files.length > 0) {
        Array.from(dt.files).forEach((f: any) => {
          if (f.path) paths.push(f.path)
          else if (f.name) paths.push(f.name)
        })
      }

      if (paths.length > 0) {
        this.sendData(paths.map((p) => {
          const escaped = p.replace(/'/g, "'\\''")
          return `'${escaped}'`
        }).join(' '))
      }
    }, true)
  }

  private _setupTouchScroll(wrapper: HTMLElement) {
    requestAnimationFrame(() => {
      const screen = wrapper.querySelector('.xterm-screen') as HTMLElement
      const viewport = wrapper.querySelector('.xterm-viewport') as HTMLElement
      if (!screen || !viewport) return

      let lastY = 0
      const onTouchStart = (e: TouchEvent) => { lastY = e.touches[0].clientY }
      const onTouchMove = (e: TouchEvent) => {
        const dy = lastY - e.touches[0].clientY
        viewport.scrollTop += dy
        lastY = e.touches[0].clientY
      }

      screen.addEventListener('touchstart', onTouchStart, { passive: true })
      screen.addEventListener('touchmove', onTouchMove, { passive: true })
      this._touchCleanup = () => {
        screen.removeEventListener('touchstart', onTouchStart)
        screen.removeEventListener('touchmove', onTouchMove)
      }
    })
  }
}
