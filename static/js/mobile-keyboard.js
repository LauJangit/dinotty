class MobileKeyboard {
  constructor(getTerminal) {
    this._getTerminal = getTerminal;
    this._bar      = null;
    this._shift    = false;
    this._ctrl     = false;
    this._kbMode   = 'action';
    this._visible  = false;
    this._shiftBtns = [];
    this._ctrlBtns  = [];
    this._altBtns   = [];
    this._alt       = false;
  }

  mount() {
    if (this._bar) return;
    this._buildDOM();
    this._bar.style.display = 'none';
    this._listenViewport();
  }

  toggle() {
    if (!this._bar) return;
    this._visible = !this._visible;
    this._bar.style.display = this._visible ? '' : 'none';
    if (this._visible) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this._applyStagger();
        this._updateHeight();
      }));
    } else {
      document.documentElement.style.setProperty('--mkb-height', '0px');
    }
    const btn = document.getElementById('kb-toggle-btn');
    if (btn) btn.classList.toggle('active', this._visible);
  }

  // ── Build ─────────────────────────────────────────────────

  _buildDOM() {
    const bar = document.createElement('div');
    bar.id = 'mobile-kb';

    // ── Main panel ────────────────────────────────────────────
    const mainPanel = document.createElement('div');
    mainPanel.id = 'mkb-main-panel';
    mainPanel.style.display = 'none';

    // Row 1: ` 1–0 - = ⌫
    mainPanel.appendChild(this._buildRow([
      { l:'`', sl:'~', s:'`' }, { l:'1',sl:'!',s:'1' }, { l:'2',sl:'@',s:'2' },
      { l:'3',sl:'#',s:'3' },   { l:'4',sl:'$',s:'4' }, { l:'5',sl:'%',s:'5' },
      { l:'6',sl:'^',s:'6' },   { l:'7',sl:'&',s:'7' }, { l:'8',sl:'*',s:'8' },
      { l:'9',sl:'(',s:'9' },   { l:'0',sl:')',s:'0' },  { l:'-',sl:'_',s:'-' },
      { l:'=',sl:'+',s:'=' },   { l:'⌫', s:'\x7f', g:1.5, cls:'mkb-mod', repeat:true },
    ]));

    // Row 2: tab q–p [ ] \
    mainPanel.appendChild(this._buildRow([
      { l:'tab', s:'\x09', g:1.5, cls:'mkb-mod' },
      { l:'q',s:'q' }, { l:'w',s:'w' }, { l:'e',s:'e' }, { l:'r',s:'r' },
      { l:'t',s:'t' }, { l:'y',s:'y' }, { l:'u',s:'u' }, { l:'i',s:'i' },
      { l:'o',s:'o' }, { l:'p',s:'p' },
      { l:'[',sl:'{',s:'[' }, { l:']',sl:'}',s:']' }, { l:'\\',sl:'|',s:'\\', g:1.5, cls:'mkb-mod' },
    ]));

    // Row 3: ⌨ a–l ; ' ↵
    mainPanel.appendChild(this._buildRow([
      { l:'⌨', sp:'kbswitch', g:1.7, cls:'mkb-mod', id:'mkb-kbswitch' },
      { l:'a',s:'a' }, { l:'s',s:'s' }, { l:'d',s:'d' }, { l:'f',s:'f' },
      { l:'g',s:'g' }, { l:'h',s:'h' }, { l:'j',s:'j' }, { l:'k',s:'k' },
      { l:'l',s:'l' }, { l:';',sl:':',s:';' }, { l:"'",sl:'"',s:"'" },
      { l:'↵', s:'\r', g:1.5, cls:'mkb-mod mkb-return' },
    ], null, 'asdf'));

    // Row 4+5: ZXCV and bottom row share right-side arrow cluster
    mainPanel.appendChild(this._buildZxcvArrows());

    bar.appendChild(mainPanel);

    bar.appendChild(this._buildActionPanel());

    document.body.appendChild(bar);
    this._bar = bar;
    this._syncKbPanels();
    let roAf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(roAf);
      roAf = requestAnimationFrame(() => {
        this._applyStagger();
        this._updateHeight();
      });
    }).observe(bar);
  }

  _buildActionPanel() {
    const panel = document.createElement('div');
    panel.id = 'mkb-action-panel';
    panel.style.display = 'none';

    // Row 1: common nav / edit actions
    panel.appendChild(this._buildRow([
      { l:'⌨', sp:'kbswitch', g:1.5, cls:'mkb-mod mkb-action-back', id:'mkb-kbswitch2' },
      { l:'esc',   s:'\x1b',   g:1.5, cls:'mkb-mod' },
      { l:'tab',   s:'\x09',   g:1.5, cls:'mkb-mod' },
      { l:'⇤',     s:'\x1b[Z', g:1.5, cls:'mkb-mod', title:'shift+tab' },
      { l:'⌫',     s:'\x7f',   g:1.5, cls:'mkb-mod', repeat:true },
    ]));

    // Row 2: ctrl combos
    panel.appendChild(this._buildRow([
      { l:'ctrl+c', s:'\x03', g:2, cls:'mkb-mod mkb-action-danger' },
      { l:'ctrl+z', s:'\x1a', g:2, cls:'mkb-mod' },
      { l:'ctrl+l', s:'\x0c', g:2, cls:'mkb-mod' },
      { l:'ctrl+r', s:'\x12', g:2, cls:'mkb-mod' },
      { l:'ctrl+d', s:'\x04', g:2, cls:'mkb-mod' },
      { l:'ctrl+k', s:'\x0b', g:2, cls:'mkb-mod' },
    ]));

    // Row 3+4: arrow cross-pad (left) + big enter (right)
    const arrowEnterRow = document.createElement('div');
    arrowEnterRow.className = 'mkb-action-arrow-enter';

    // Arrow cross: ↑ on top centered, ← ↓ → on bottom
    const arrowPad = document.createElement('div');
    arrowPad.className = 'mkb-action-arrowpad';

    const arrowTop = document.createElement('div');
    arrowTop.className = 'mkb-action-arrow-top';
    arrowTop.appendChild(this._buildKey({ l:'↑', s:'\x1b[A', cls:'mkb-mod mkb-action-arrow', repeat:true }));

    const arrowBot = document.createElement('div');
    arrowBot.className = 'mkb-action-arrow-bot';
    [
      { l:'←', s:'\x1b[D', cls:'mkb-mod mkb-action-arrow', repeat:true },
      { l:'↓', s:'\x1b[B', cls:'mkb-mod mkb-action-arrow', repeat:true },
      { l:'→', s:'\x1b[C', cls:'mkb-mod mkb-action-arrow', repeat:true },
    ].forEach(k => arrowBot.appendChild(this._buildKey(k)));

    arrowPad.append(arrowTop, arrowBot);

    // Big Enter key
    const enterBtn = this._buildKey({ l:'↵', s:'\r', cls:'mkb-mod mkb-action-enter mkb-return' });

    arrowEnterRow.append(arrowPad, enterBtn);
    panel.appendChild(arrowEnterRow);

    // Bottom row: ctrl/opt/space
    panel.appendChild(this._buildRow([
      { l:'ctrl', sp:'ctrl', g:1, cls:'mkb-mod', id:'mkb-ctrl2' },
      { l:'opt',  sp:'alt',  g:1, cls:'mkb-mod', id:'mkb-alt2'  },
      { l:'⌘',    sp:'cmd',  g:1, cls:'mkb-mod' },
      { l:'',     s:' ',     g:5, id:'mkb-space2' },
    ]));

    return panel;
  }

  _kbBarLaidOut() {
    if (!this._bar || this._bar.style.display === 'none') return false;
    const r = this._bar.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  // Measure actual 1u key width and set pixel-accurate stagger
  _applyStagger() {
    if (!this._kbBarLaidOut()) return;
    const { w: qW, h: qH, gap } = this._measureRefKey();
    if (!qW || !qH) return;

    const u = qW + gap;

    // ASDF row stagger: a starts at 1.75u; pull ⌨ outside the padding so it left-aligns
    const asdfPad = Math.round(0.75 * u);
    this._bar.querySelectorAll('.mkb-stagger-asdf .mkb-row').forEach(r => r.style.paddingLeft = asdfPad + 'px');

    // Pull the ⌨ key left so it starts at the row's left edge (ignoring the stagger padding)
    const kbswitchKey = this._bar.querySelector('#mkb-kbswitch');
    if (kbswitchKey) {
      kbswitchKey.style.marginLeft = -asdfPad + 'px';
    }

    // Fix all letter keys in ASDF and ZXCV rows to exactly qW
    const isLetter = el => /^[a-z]$/.test(el.dataset.lo || '') || el.classList.contains('mkb-alpha');
    this._bar.querySelectorAll('.mkb-stagger-asdf .mkb-btn, .mkb-row-zxcv .mkb-btn')
      .forEach(k => {
        if (isLetter(k)) {
          k.style.flexGrow   = '0';
          k.style.flexShrink = '0';
          k.style.flexBasis  = qW + 'px';
        }
      });

    // then set ZXCV paddingLeft so z aligns under their midpoint.
    this._bar.querySelectorAll('.mkb-arrow').forEach(k => {
      k.style.width  = qW + 'px';
      k.style.height = qH + 'px';
    });
    const arrowTop = this._bar.querySelector('.mkb-arrow-top');
    if (arrowTop) arrowTop.style.paddingLeft = (qW + gap) + 'px';
    requestAnimationFrame(() => {
      if (!this._kbBarLaidOut()) return;
      const aKey = this._bar.querySelector('[data-lo="a"]');
      const sKey = this._bar.querySelector('[data-lo="s"]');
      const shiftKey = this._bar.querySelector('#mkb-shift');
      const zxcvRow = this._bar.querySelector('.mkb-row-zxcv');
      if (!aKey || !sKey || !shiftKey || !zxcvRow) return;

      const rowRect   = zxcvRow.getBoundingClientRect();
      const aLeft     = aKey.getBoundingClientRect().left;
      const sLeft     = sKey.getBoundingClientRect().left;
      const zTarget   = (aLeft + sLeft) / 2;          // z's desired left edge
      const shiftRight = shiftKey.getBoundingClientRect().right + gap; // first available pixel after ⇧

      const zxcvPad = Math.round(zTarget - shiftRight);
      zxcvRow.style.paddingLeft = Math.max(0, zxcvPad) + 'px';

      // Make shift slightly wider than fn
      const fnKey = [...this._bar.querySelectorAll('.mkb-btn')].find(b => b.textContent === 'fn');
      if (fnKey && shiftKey) {
        const fnW = fnKey.getBoundingClientRect().width;
        shiftKey.style.flexGrow   = '0';
        shiftKey.style.flexShrink = '0';
        shiftKey.style.flexBasis  = (fnW + 32) + 'px';
      }
    });
  }

  // Row 4+5: ZXCV (top-left) + bottom row (bottom-left) + arrow cluster (right, spanning both rows)
  _buildZxcvArrows() {
    const wrap = document.createElement('div');
    wrap.className = 'mkb-zxcv-bottom mkb-stagger-zxcv';

    const left = document.createElement('div');
    left.className = 'mkb-zxcv-left';

    const r4 = document.createElement('div');
    r4.className = 'mkb-row mkb-row-zxcv';
    [
      { l:'⇧', sp:'shift', g:1.5, cls:'mkb-mod', id:'mkb-shift' },
      { l:'z',s:'z' }, { l:'x',s:'x' }, { l:'c',s:'c' }, { l:'v',s:'v' },
      { l:'b',s:'b' }, { l:'n',s:'n' }, { l:'m',s:'m' },
      { l:',',sl:'<',s:',' ,cls:'mkb-alpha'}, { l:'.',sl:'>',s:'.',cls:'mkb-alpha' }, { l:'/',sl:'?',s:'/',cls:'mkb-alpha' },
    ].forEach(k => r4.appendChild(this._buildKey(k)));
    left.appendChild(r4);

    const r5 = document.createElement('div');
    r5.className = 'mkb-row';
    [
      { l:'fn',   sp:'fn',   g:1, cls:'mkb-mod' },
      { l:'ctrl', sp:'ctrl', g:1, cls:'mkb-mod', id:'mkb-ctrl' },
      { l:'opt',  sp:'alt',  g:1, cls:'mkb-mod', id:'mkb-alt' },
      { l:'⌘',    sp:'cmd',  g:1, cls:'mkb-mod' },
      { l:'',     s:' ', g:4, id:'mkb-space' },
    ].forEach(k => r5.appendChild(this._buildKey(k)));
    left.appendChild(r5);

    wrap.appendChild(left);

    // Arrow cluster spanning both rows: ↑ on top, ← ↓ → on bottom
    const right = document.createElement('div');
    right.className = 'mkb-arrow-cluster';

    const topRow = document.createElement('div');
    topRow.className = 'mkb-arrow-row mkb-arrow-top';
    topRow.appendChild(this._buildKey({ l:'↑', s:'\x1b[A', repeat:true, cls:'mkb-arrow' }));

    const botRow = document.createElement('div');
    botRow.className = 'mkb-arrow-row';
    [
      { l:'←', s:'\x1b[D', repeat:true, cls:'mkb-arrow' },
      { l:'↓', s:'\x1b[B', repeat:true, cls:'mkb-arrow' },
      { l:'→', s:'\x1b[C', repeat:true, cls:'mkb-arrow' },
    ].forEach(k => botRow.appendChild(this._buildKey(k)));

    right.append(topRow, botRow);
    wrap.appendChild(right);

    return wrap;
  }

  // main keys + optional right-column nav key
  _buildRow(keys, navKeys, stagger) {
    const wrap = document.createElement('div');
    wrap.className = 'mkb-row-wrap' + (stagger ? ' mkb-stagger-' + stagger : '');

    const main = document.createElement('div');
    main.className = 'mkb-row';
    keys.forEach(k => main.appendChild(this._buildKey(k)));
    wrap.appendChild(main);

    if (navKeys) {
      const nav = document.createElement('div');
      nav.className = 'mkb-nav-col';
      navKeys.forEach(k => nav.appendChild(this._buildKey(k)));
      wrap.appendChild(nav);
    }

    return wrap;
  }

  // ── Key factory ───────────────────────────────────────────

  _buildKey(k) {
    const btn = document.createElement('button');
    btn.className = 'mkb-btn' + (k.cls ? ' ' + k.cls : '');
    if (k.id) btn.id = k.id;
    btn.style.flexGrow  = k.g ?? 1;
    btn.style.flexBasis = '0';
    btn.textContent = k.l;

    if (k.sl) { btn.dataset.lo = k.l; btn.dataset.hi = k.sl; }
    else if (k.s && k.s.length === 1 && k.s >= 'a' && k.s <= 'z') {
      btn.dataset.lo = k.l; btn.dataset.hi = k.l.toUpperCase();
    }

    if (k.s) {
      const fire = () => {
        let ch = k.s;
        const up = this._shift;
        if (up) {
          if (k.sl) ch = k.sl;
          else if (ch >= 'a' && ch <= 'z') ch = ch.toUpperCase();
        }
        if (this._ctrl && ch.length === 1) {
          const code = ch.toUpperCase().charCodeAt(0) - 64;
          if (code >= 1 && code <= 26) ch = String.fromCharCode(code);
          this._setCtrl(false);
        }
        if (this._alt) {
          ch = '\x1b' + ch;
          this._setAlt(false);
        }
        this._send(ch);
        if (this._shift) this._setShift(false);
      };
      if (k.repeat) this._addRepeat(btn, fire);
      else {
        btn.addEventListener('touchstart', e => { e.preventDefault(); fire(); }, { passive: false });
        btn.addEventListener('mousedown',  e => { e.preventDefault(); fire(); });
      }
    }

    if (k.sp) this._bindSpecial(btn, k.sp);
    return btn;
  }

  // ── Specials ──────────────────────────────────────────────

  _bindSpecial(btn, sp) {
    const handler = () => {
      if (sp === 'shift') {
        this._setShift(!this._shift);
      }
      if (sp === 'ctrl') this._setCtrl(!this._ctrl);
      if (sp === 'alt')  this._setAlt(!this._alt);
      if (sp === 'cmd')  { /* macOS ⌘ — no-op on a web terminal */ }
      if (sp === 'fn')   { /* fn key — no-op */ }
      if (sp === 'kbswitch') this._switchKeyboard(btn);
    };
    btn.addEventListener('touchstart', e => { e.preventDefault(); handler(); }, { passive: false });
    btn.addEventListener('mousedown',  e => { e.preventDefault(); handler(); });

    if (sp === 'shift') this._shiftBtns.push(btn);
    if (sp === 'ctrl')  this._ctrlBtns.push(btn);
    if (sp === 'alt')   this._altBtns.push(btn);
  }

  _syncKbPanels() {
    if (!this._bar) return;
    const isDefault = this._kbMode === 'default';
    const isAction = this._kbMode === 'action';
    const mainPanel = this._bar.querySelector('#mkb-main-panel');
    const actionPanel = this._bar.querySelector('#mkb-action-panel');
    mainPanel.style.display = isDefault ? '' : 'none';
    actionPanel.style.display = isAction ? '' : 'none';
    const label = isAction ? '⌨✕' : '⌨⌨';
    this._bar.querySelectorAll('[id^="mkb-kbswitch"]').forEach(b => {
      b.textContent = label;
      b.classList.toggle('active', isAction);
    });
    ['#mkb-ctrl2', '#mkb-ctrl'].forEach(sel => {
      const el = this._bar.querySelector(sel);
      if (el && !this._ctrlBtns.includes(el)) this._ctrlBtns.push(el);
      el && el.classList.toggle('active', this._ctrl);
    });
    ['#mkb-alt2', '#mkb-alt'].forEach(sel => {
      const el = this._bar.querySelector(sel);
      if (el && !this._altBtns.includes(el)) this._altBtns.push(el);
      el && el.classList.toggle('active', this._alt);
    });
  }

  _switchKeyboard(btn) {
    this._kbMode = this._kbMode === 'action' ? 'default' : 'action';
    this._syncKbPanels();
    requestAnimationFrame(() => {
      this._applyStagger();
      this._updateHeight();
    });
  }

  _measureRefKey() {
    const gap = 4;
    const main = this._bar.querySelector('#mkb-main-panel');
    const q = this._bar.querySelector('[data-lo="q"]');
    if (q && main && main.offsetParent !== null) {
      const r = q.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height, gap };
    }
    const order = ['#mkb-action-panel', '#mkb-main-panel'];
    for (const sel of order) {
      const panel = this._bar.querySelector(sel);
      if (!panel || panel.offsetParent === null) continue;
      const rows = panel.querySelectorAll('.mkb-row');
      for (const row of rows) {
        const rects = [...row.querySelectorAll('.mkb-btn')]
          .filter(b => {
            if ((b.id || '').includes('space')) return false;
            const g = parseFloat(b.style.flexGrow);
            return !(Number.isFinite(g) && g > 2);
          })
          .map(b => b.getBoundingClientRect())
          .filter(r => r.width > 4 && r.height > 4);
        if (rects.length < 2) continue;
        const ws = rects.map(r => r.width).sort((a, b) => a - b);
        const hs = rects.map(r => r.height).sort((a, b) => a - b);
        const mid = x => x[Math.floor(x.length / 2)];
        return { w: mid(ws), h: mid(hs), gap };
      }
    }
    return { w: 0, h: 0, gap };
  }

  _setShift(on) {
    this._shift = on;
    this._shiftBtns.forEach(b => b.classList.toggle('active', on || this._caps));
    this._updateLabels();
  }

  _setCtrl(on) {
    this._ctrl = on;
    this._ctrlBtns.forEach(b => b.classList.toggle('active', on));
  }

  _setAlt(on) {
    this._alt = on;
    this._altBtns.forEach(b => b.classList.toggle('active', on));
  }

  _updateLabels() {
    if (!this._bar) return;
    const up = this._shift;
    this._bar.querySelectorAll('[data-lo]').forEach(b => {
      b.textContent = up ? b.dataset.hi : b.dataset.lo;
    });
  }

  // ── Repeat / send ─────────────────────────────────────────

  _addRepeat(btn, fn) {
    let timer, iv;
    const start = e => { e.preventDefault(); fn(); timer = setTimeout(() => { iv = setInterval(fn, 80); }, 400); };
    const stop  = () => { clearTimeout(timer); clearInterval(iv); };
    btn.addEventListener('touchstart',  start, { passive: false });
    btn.addEventListener('touchend',    stop);
    btn.addEventListener('touchcancel', stop);
    btn.addEventListener('mousedown',   start);
    btn.addEventListener('mouseup',     stop);
    btn.addEventListener('mouseleave',  stop);
  }

  _send(data) {
    const t = this._getTerminal();
    t && t.sendData(data);
  }

  // ── Viewport ──────────────────────────────────────────────

  _listenViewport() {
    if (!window.visualViewport) return;
    let naturalVH = window.visualViewport.height;
    // Reset natural height on orientation change so landscape→portrait doesn't
    // permanently appear as "system keyboard open".
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { naturalVH = window.visualViewport.height; }, 300);
    });
    const upd = () => {
      const vh = window.visualViewport.height;
      if (vh > naturalVH) naturalVH = vh;
      const off = window.innerHeight - (window.visualViewport.offsetTop + vh);
      // System keyboard detected: viewport shrinks by >120px from its natural height
      const sysKbOpen = (naturalVH - vh) > 120;
      if (this._bar) {
        this._bar.style.display = (sysKbOpen || !this._visible) ? 'none' : '';
        if (!sysKbOpen && this._visible) this._bar.style.bottom = `${Math.max(0, off)}px`;
      }
      this._updateHeight();
    };
    window.visualViewport.addEventListener('resize', upd);
    window.visualViewport.addEventListener('scroll', upd);
  }

  _updateHeight() {
    if (!this._bar) return;
    document.documentElement.style.setProperty('--mkb-height', `${this._bar.getBoundingClientRect().height}px`);
  }
}
