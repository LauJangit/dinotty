/**
 * CommandPalette — Ghostty-style fuzzy command palette.
 *
 * Usage:
 *   const palette = new CommandPalette(backdropEl, inputEl, listEl);
 *   palette.setCommands(commands);   // [{icon, title, subtitle, kbd, action}]
 *   palette.open();
 *   palette.close();
 *   palette.toggle();
 */

class CommandPalette {
  constructor(backdrop, input, list) {
    this._backdrop = backdrop;
    this._input    = input;
    this._list     = list;
    this._commands = [];
    this._filtered = [];
    this._selected = 0;
    this._open     = false;

    this._input.addEventListener('input', () => this._update());
    this._input.addEventListener('keydown', (e) => this._onKey(e));
    this._backdrop.addEventListener('mousedown', (e) => {
      if (e.target === this._backdrop) this.close();
    });
  }

  setCommands(commands) {
    this._commands = commands;
  }

  open() {
    this._open = true;
    this._input.value = '';
    this._backdrop.classList.add('open');
    this._update();
    requestAnimationFrame(() => this._input.focus());
  }

  close() {
    this._open = false;
    this._backdrop.classList.remove('open');
  }

  toggle() {
    this._open ? this.close() : this.open();
  }

  // ── Private ───────────────────────────────────────────────

  _update() {
    const q = this._input.value.trim().toLowerCase();
    this._filtered = q
      ? this._commands.filter(c =>
          fuzzyMatch(c.title, q) !== null ||
          (c.subtitle && c.subtitle.toLowerCase().includes(q))
        ).sort((a, b) => {
          const sa = fuzzyMatch(a.title, q) || 999;
          const sb = fuzzyMatch(b.title, q) || 999;
          return sa - sb;
        })
      : this._commands;

    this._selected = 0;
    this._render(q);
  }

  _render(q = '') {
    this._list.innerHTML = '';

    if (this._filtered.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'palette-empty';
      empty.textContent = 'No matching commands';
      this._list.append(empty);
      return;
    }

    this._filtered.forEach((cmd, i) => {
      const item = document.createElement('div');
      item.className = 'palette-item' + (i === this._selected ? ' selected' : '');

      const icon = document.createElement('div');
      icon.className = 'palette-item-icon';
      icon.textContent = cmd.icon || '›';

      const body = document.createElement('div');
      body.className = 'palette-item-body';

      const titleEl = document.createElement('div');
      titleEl.className = 'palette-item-title';
      titleEl.innerHTML = q ? highlightFuzzy(cmd.title, q) : escHtml(cmd.title);

      body.append(titleEl);

      if (cmd.subtitle) {
        const sub = document.createElement('div');
        sub.className = 'palette-item-subtitle';
        sub.textContent = cmd.subtitle;
        body.append(sub);
      }

      item.append(icon, body);

      if (cmd.kbd && cmd.kbd.length) {
        const kbdWrap = document.createElement('div');
        kbdWrap.className = 'palette-item-kbd';
        cmd.kbd.forEach(k => {
          const kbd = document.createElement('kbd');
          kbd.textContent = k;
          kbdWrap.append(kbd);
        });
        item.append(kbdWrap);
      }

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._execute(i);
      });
      item.addEventListener('mouseenter', () => {
        this._selected = i;
        this._highlight();
      });

      this._list.append(item);
    });
  }

  _highlight() {
    const items = this._list.querySelectorAll('.palette-item');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === this._selected);
    });
    const sel = items[this._selected];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  _onKey(e) {
    if (e.key === 'Escape') { this.close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._selected = Math.min(this._selected + 1, this._filtered.length - 1);
      this._highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._selected = Math.max(this._selected - 1, 0);
      this._highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._execute(this._selected);
    }
  }

  _execute(i) {
    const cmd = this._filtered[i];
    if (!cmd) return;
    this.close();
    setTimeout(() => cmd.action(), 10);
  }
}

// ── Fuzzy match helpers ───────────────────────────────────────

/** Returns a score (lower=better) or null if no match */
function fuzzyMatch(str, query) {
  const s = str.toLowerCase();
  let si = 0, qi = 0, score = 0, lastMatch = -1;
  while (si < s.length && qi < query.length) {
    if (s[si] === query[qi]) {
      score += (si - lastMatch - 1); // gaps penalize
      lastMatch = si;
      qi++;
    }
    si++;
  }
  return qi === query.length ? score : null;
}

/** Returns HTML string with matching chars wrapped in <mark> */
function highlightFuzzy(str, query) {
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  const positions = new Set();
  let si = 0, qi = 0;
  while (si < s.length && qi < q.length) {
    if (s[si] === q[qi]) { positions.add(si); qi++; }
    si++;
  }
  if (qi < q.length) return escHtml(str);
  return [...str].map((c, i) =>
    positions.has(i) ? `<mark>${escHtml(c)}</mark>` : escHtml(c)
  ).join('');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
