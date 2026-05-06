/**
 * Terminal — wraps a single xterm.js instance + WebSocket session.
 *
 * Usage:
 *   const t = new Terminal(paneId);
 *   t.attach(wrapperEl);   // open xterm inside element
 *   t.focus();
 *   t.destroy();
 */
class Terminal {
  constructor(paneId) {
    this.paneId = paneId;
    this.ws = null;
    this.xterm = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this._wrapper = null;

    // callbacks
    this.onTitleChange = null;   // (title) => void
    this.onShellInfo   = null;   // (shellType) => void
    this.onConnect     = null;   // () => void
    this.onDisconnect  = null;   // () => void
  }

  attach(wrapper) {
    this._wrapper = wrapper;

    const s = getComputedStyle(document.documentElement);
    const v = name => s.getPropertyValue(name).trim();

    this.xterm = new window.Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: v('--font-mono'),
      allowProposedApi: true,
      theme: {
        background:          v('--bg'),
        foreground:          v('--fg'),
        cursor:              v('--fg-muted'),
        cursorAccent:        v('--color-black'),
        selectionBackground: 'rgba(77,127,255,0.35)',
        black:               v('--color-black'),
        red:                 v('--color-red'),
        green:               v('--color-green'),
        yellow:              v('--color-yellow'),
        blue:                v('--color-blue'),
        magenta:             v('--color-magenta'),
        cyan:                v('--color-cyan'),
        white:               v('--color-white'),
        brightBlack:         v('--color-bright-black'),
        brightRed:           v('--color-bright-red'),
        brightGreen:         v('--color-bright-green'),
        brightYellow:        v('--color-bright-yellow'),
        brightBlue:          v('--color-bright-blue'),
        brightMagenta:       v('--color-bright-magenta'),
        brightCyan:          v('--color-bright-cyan'),
        brightWhite:         v('--color-bright-white'),
      },
    });

    this.fitAddon = new FitAddon.FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.open(wrapper);

    // Wait for layout to settle before first fit
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.fitAddon.fit());
    });

    // Forward title changes
    this.xterm.onTitleChange(title => {
      this.onTitleChange && this.onTitleChange(title);
    });

    this._connectWS();

    // Auto-fit on container resize
    this.resizeObserver = new ResizeObserver(() => this._refit());
    this.resizeObserver.observe(wrapper);

    // xterm-screen captures all touch events (touch-action:none), so native
    // scroll on the xterm-viewport never fires on mobile. Forward touch deltas
    // manually to keep scrollback working on touchscreens.
    requestAnimationFrame(() => {
      const screen   = wrapper.querySelector('.xterm-screen');
      const viewport = wrapper.querySelector('.xterm-viewport');
      if (!screen || !viewport) return;
      let lastY = 0;
      const onTouchStart = e => { lastY = e.touches[0].clientY; };
      const onTouchMove  = e => {
        const dy = lastY - e.touches[0].clientY;
        viewport.scrollTop += dy;
        lastY = e.touches[0].clientY;
      };
      screen.addEventListener('touchstart', onTouchStart, { passive: true });
      screen.addEventListener('touchmove',  onTouchMove,  { passive: true });
      this._touchCleanup = () => {
        screen.removeEventListener('touchstart', onTouchStart);
        screen.removeEventListener('touchmove',  onTouchMove);
      };
    });
  }

  focus() {
    this.xterm && this.xterm.focus();
  }

  fit() {
    this._refit();
  }

  sendData(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  destroy() {
    this.resizeObserver && this.resizeObserver.disconnect();
    this._touchCleanup && this._touchCleanup();
    this.ws && this.ws.close();
    this.xterm && this.xterm.dispose();
    this.xterm = null;
    this.ws = null;
  }

  // ── Private ──────────────────────────────────────────────

  _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws?paneId=${encodeURIComponent(this.paneId)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.onConnect && this.onConnect();
      this._refit();
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'output') {
        this.xterm.write(msg.data);
      } else if (msg.type === 'shell_info') {
        this.onShellInfo && this.onShellInfo(msg.shell_type);
      }
    };

    this.ws.onclose = () => {
      this.onDisconnect && this.onDisconnect();
      this.xterm && this.xterm.write('\r\n\x1b[2m[disconnected]\x1b[0m\r\n');
    };

    this.ws.onerror = () => {
      this.onDisconnect && this.onDisconnect();
    };

    this.xterm.onData(data => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  _refit() {
    if (!this.fitAddon || !this._wrapper) return;
    this.fitAddon.fit();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.xterm.cols,
        rows: this.xterm.rows,
      }));
    }
  }
}
