class Terminal {
  constructor(paneId) {
    this.paneId = paneId;
    this.ws = null;
    this.xterm = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this._wrapper = null;
    this._destroyed = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;

    this.onTitleChange = null;
    this.onShellInfo   = null;
    this.onConnect     = null;
    this.onDisconnect  = null;
  }

  attach(wrapper) {
    this._wrapper = wrapper;

    const s = getComputedStyle(document.documentElement);
    const v = name => s.getPropertyValue(name).trim();

    this.xterm = new window.Terminal({
      cursorBlink: true,
      scrollback: 10000,
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

    if (window.WebLinksAddon) {
      const linksAddon = new WebLinksAddon.WebLinksAddon((event, uri) => {
        console.log('[WebLinksAddon] clicked:', uri);
        try {
          const url = new URL(uri);
          const host = url.hostname;
          if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
            const port = parseInt(url.port) || 80;
            if (port >= 1024) {
              event.preventDefault();
              openPreview(port, url.pathname + url.search);
              return;
            }
          }
        } catch (e) {
          console.error('[WebLinksAddon] error:', e);
        }
        window.open(uri, '_blank');
      });
      this.xterm.loadAddon(linksAddon);
    } else {
      console.warn('[Terminal] WebLinksAddon not loaded');
    }

    this.xterm.open(wrapper);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.fitAddon.fit());
    });

    this.xterm.onTitleChange(title => {
      if (this._suppressTitleChange) return;
      this.onTitleChange && this.onTitleChange(title);
    });

    this._connectWS();

    const xtermEl = wrapper.querySelector('.xterm');
    (xtermEl || wrapper).addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    }, true);
    (xtermEl || wrapper).addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const types = Array.from(e.dataTransfer.types);
      console.log('[drop] types:', types);
      console.log('[drop] text/uri-list:', e.dataTransfer.getData('text/uri-list'));
      console.log('[drop] text/plain:', e.dataTransfer.getData('text/plain'));
      if (e.dataTransfer.files.length > 0) {
        const f = e.dataTransfer.files[0];
        console.log('[drop] file:', { name: f.name, path: f.path, type: f.type, webkitRelativePath: f.webkitRelativePath });
      }
      const paths = [];
      if (types.includes('text/uri-list')) {
        const uriList = e.dataTransfer.getData('text/uri-list');
        uriList.split('\n').forEach(u => {
          u = u.trim();
          if (!u || u.startsWith('#')) return;
          try { paths.push(decodeURIComponent(new URL(u).pathname)); } catch {}
        });
      }
      if (paths.length === 0 && types.includes('text/plain')) {
        const text = e.dataTransfer.getData('text/plain').trim();
        if (text && text.startsWith('/')) {
          text.split('\n').forEach(l => { if (l.trim()) paths.push(l.trim()); });
        }
      }
      if (paths.length === 0 && e.dataTransfer.files.length > 0) {
        Array.from(e.dataTransfer.files).forEach(f => {
          if (f.path) paths.push(f.path);
          else if (f.name) paths.push(f.name);
        });
      }
      if (paths.length > 0) {
        this.sendData(paths.map(p => {
          const escaped = p.replace(/'/g, "'\\''");
          return `'${escaped}'`;
        }).join(' '));
      }
    }, true);

    this.resizeObserver = new ResizeObserver(() => this._refit());
    this.resizeObserver.observe(wrapper);

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
    this._destroyed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this.resizeObserver && this.resizeObserver.disconnect();
    this._touchCleanup && this._touchCleanup();
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    this.xterm && this.xterm.dispose();
    this.xterm = null;
  }

  // ── Private ──────────────────────────────────────────────

  _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws?paneId=${encodeURIComponent(this.paneId)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._reconnectAttempts = 0;
      this._hideOverlay();
      this.onConnect && this.onConnect();
      this._refit();
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'reconnected') {
        this._suppressTitleChange = true;
        this.xterm.reset();
        this._suppressTitleChange = false;
        this._reconnectAttempts = 0;
        this._hideOverlay();
      } else if (msg.type === 'output') {
        this.xterm.write(msg.data);
      } else if (msg.type === 'shell_info') {
        this.onShellInfo && this.onShellInfo(msg.shell_type);
      }
    };

    this.ws.onclose = (e) => {
      if (this._destroyed) return;
      this.onDisconnect && this.onDisconnect();
      if (e.code === 1000) {
        this.xterm && this.xterm.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
      } else {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = () => {};

    if (!this._onDataRegistered) {
      this._onDataRegistered = true;
      this.xterm.onData(data => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data }));
        }
      });
    }
  }

  _scheduleReconnect() {
    if (this._destroyed) return;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);
    this._reconnectAttempts++;
    this._showOverlay();
    this._reconnectTimer = setTimeout(() => this._connectWS(), delay);
  }

  _showOverlay() {
    if (!this._wrapper || this._overlay) return;
    this._overlay = document.createElement('div');
    this._overlay.className = 'reconnect-overlay';
    this._overlay.textContent = 'Connection lost. Reconnecting...';
    this._wrapper.style.position = 'relative';
    this._wrapper.appendChild(this._overlay);
  }

  _hideOverlay() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
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
