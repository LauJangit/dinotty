import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { ClientMsg, ServerMsg } from '../types/protocol'
import { isTauri, createTransport, type Transport } from './useTransport'
import { onThemeChange, settings, onTextChange } from './useSettings'
import { wsUrlWithToken } from './apiBase'

let tauriDragDropRegistered = false
let lastFocusedInstance: TerminalInstance | null = null

function setupGlobalTauriDragDrop() {
  if (tauriDragDropRegistered) return
  tauriDragDropRegistered = true

  const w = window as any
  const listen = w.__TAURI__?.event?.listen
  if (!listen) return

  listen('file-drop-paths', (event: any) => {
    const paths: string[] = event.payload || []
    if (paths.length > 0 && lastFocusedInstance) {
      const escaped = paths.map((p: string) =>
        /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
      )
      lastFocusedInstance.sendData(escaped.join(' '))
    }
  })
}

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
  private _focusinCleanup: (() => void) | null = null
  private _compositionCleanup: (() => void) | null = null
  private _compositionGuard: ((data: string) => boolean) | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _themeUnsub: (() => void) | null = null
  private _textUnsub: (() => void) | null = null
  private _refitTimer: ReturnType<typeof setTimeout> | null = null
  private _lastCols = 0
  private _lastRows = 0

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

    const fontFamily = settings.text.font_family || v('--font-mono')

    this.xterm = new XTerm({
      cursorBlink: settings.text.cursor_blink,
      cursorStyle: settings.text.cursor_style as any,
      scrollback: settings.text.scrollback,
      fontSize: settings.text.font_size,
      fontFamily,
      lineHeight: settings.text.line_height,
      letterSpacing: settings.text.letter_spacing,
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

    const unicode11 = new Unicode11Addon()
    this.xterm.loadAddon(unicode11)
    this.xterm.unicode.activeVersion = '11'

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      this.xterm.loadAddon(webgl)
    } catch { /* DOM renderer fallback */ }

    const textarea = wrapper.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    if (textarea) {
      let compositionJustEnded = false
      let compositionData = ''
      const onCompositionEnd = (e: Event) => {
        compositionJustEnded = true
        compositionData = ''
        setTimeout(() => { compositionJustEnded = false; compositionData = '' }, 0)
      }
      textarea.addEventListener('compositionend', onCompositionEnd)
      this._compositionCleanup = () => {
        textarea.removeEventListener('compositionend', onCompositionEnd)
      }
      this._compositionGuard = (data: string): boolean => {
        if (!compositionJustEnded) return true
        if (compositionData === '') {
          compositionData = data
          return true
        }
        if (data === compositionData) return false
        return true
      }
    }

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

    this._themeUnsub = onThemeChange((xtermTheme) => {
      if (this.xterm) this.xterm.options.theme = xtermTheme
    })

    this._textUnsub = onTextChange((text) => {
      if (!this.xterm) return
      this.xterm.options.fontSize = text.font_size
      this.xterm.options.fontFamily = text.font_family || getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      this.xterm.options.lineHeight = text.line_height
      this.xterm.options.letterSpacing = text.letter_spacing
      this.xterm.options.cursorBlink = text.cursor_blink
      this.xterm.options.cursorStyle = text.cursor_style as any
      this.xterm.options.scrollback = text.scrollback
      this._refit()
    })
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
    if (this._refitTimer) clearTimeout(this._refitTimer)
    this._resizeObserver?.disconnect()
    this._touchCleanup?.()
    this._focusinCleanup?.()
    this._compositionCleanup?.()
    this._themeUnsub?.()
    this._textUnsub?.()
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
        this._lastCols = 0
        this._lastRows = 0
        this._refit()
      }
    })

    this._transport.onDisconnect(() => {
      this.onDisconnect?.()
    })

    this.xterm!.onData((data) => {
      if (this._compositionGuard && !this._compositionGuard(data)) return
      this._transport?.send({ type: 'input', data })
    })
  }

  // ── Private ──────────────────────────────────────────────

  private _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = wsUrlWithToken(`${proto}//${location.host}/ws?paneId=${encodeURIComponent(this.paneId)}`)
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
        this._lastCols = 0
        this._lastRows = 0
        this._refit()
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
        if (this._compositionGuard && !this._compositionGuard(data)) return
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

    const text = document.createElement('span')
    text.textContent = 'Connection lost. Reconnecting...'

    const btn = document.createElement('button')
    btn.className = 'reconnect-retry-btn'
    btn.textContent = 'Retry Now'
    btn.addEventListener('click', () => {
      if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
      this._reconnectAttempts = 0
      this._hideOverlay()
      this._connectWS()
    })

    this._overlay.appendChild(text)
    this._overlay.appendChild(btn)
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
    if (this._refitTimer) clearTimeout(this._refitTimer)
    this._refitTimer = setTimeout(() => {
      if (!this.fitAddon || !this.xterm) return
      this.fitAddon.fit()
      const cols = this.xterm.cols
      const rows = this.xterm.rows
      if (cols === this._lastCols && rows === this._lastRows) return
      this._lastCols = cols
      this._lastRows = rows
      const resizeMsg: ClientMsg = { type: 'resize', cols, rows }
      if (this._transport) {
        this._transport.send(resizeMsg)
      } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(resizeMsg))
      }
    }, 100)
  }

  private _setupDragDrop(wrapper: HTMLElement) {
    if (isTauri()) {
      lastFocusedInstance = this
      const handler = () => { lastFocusedInstance = this }
      wrapper.addEventListener('focusin', handler)
      this._focusinCleanup = () => wrapper.removeEventListener('focusin', handler)
      setupGlobalTauriDragDrop()
    }

    // Listen for custom 'terminal-drop-path' events dispatched by the file tree
    // when Tauri's native layer intercepts HTML5 drop events.
    wrapper.addEventListener('terminal-drop-path', ((e: CustomEvent) => {
      const path = e.detail?.path as string
      if (!path) return
      const escaped = /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(path)
        ? `'${path.replace(/'/g, "'\\''")}'`
        : path
      this.sendData(escaped)
    }) as EventListener)

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
        const absPlain =
          text &&
          (text.startsWith('/') ||
            /^[A-Za-z]:[\\/]/.test(text) ||
            text.startsWith('\\\\'))
        if (absPlain) {
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
        const escaped = paths.map((p) =>
          /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
        )
        this.sendData(escaped.join(' '))
      }
    }, true)
  }

  private _setupTouchScroll(wrapper: HTMLElement) {
    requestAnimationFrame(() => {
      const screen = wrapper.querySelector('.xterm-screen') as HTMLElement
      const viewport = wrapper.querySelector('.xterm-viewport') as HTMLElement
      if (!screen || !viewport) return

      let startX = 0
      let startY = 0
      let lastY = 0
      let mode: 'undecided' | 'scroll' | 'select' = 'undecided'
      const THRESHOLD = 10

      const onTouchStart = (e: TouchEvent) => {
        startX = e.touches[0].clientX
        startY = e.touches[0].clientY
        lastY = startY
        mode = 'undecided'
      }
      const onTouchMove = (e: TouchEvent) => {
        const cx = e.touches[0].clientX
        const cy = e.touches[0].clientY
        if (mode === 'undecided') {
          const dx = Math.abs(cx - startX)
          const dy = Math.abs(cy - startY)
          if (dy > THRESHOLD || dx > THRESHOLD) {
            mode = dy > dx ? 'scroll' : 'select'
          } else {
            return
          }
        }
        if (mode === 'scroll') {
          viewport.scrollTop += lastY - cy
        }
        lastY = cy
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
