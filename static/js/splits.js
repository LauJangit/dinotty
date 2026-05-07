/**
 * SplitTree — Ghostty-style resizable binary split tree.
 *
 * Nodes:
 *   { kind: 'leaf',  pane }
 *   { kind: 'split', dir: 'horizontal'|'vertical', ratio, left, right, el }
 *
 * Public API:
 *   const tree = new SplitTree(containerEl, onFocusChange);
 *   tree.init()                    → first Pane
 *   tree.splitPane(pane, dir)      → new Pane
 *   tree.closePane(pane)
 *   tree.destroyAll()
 */

let _paneSeq = 0;

class Pane {
  constructor() {
    this.id = `p${++_paneSeq}-${Math.random().toString(36).slice(2, 6)}`;
    this.terminal = null;
    this.el = null;
    this._statusEl = null;
    this._shellEl = null;
    this._titleEl = null;
  }

  buildEl(onClose) {
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.paneId = this.id;

    const header = document.createElement('div');
    header.className = 'pane-header';

    const status = document.createElement('span');
    status.className = 'pane-status';
    this._statusEl = status;

    const title = document.createElement('span');
    title.className = 'pane-title';
    title.textContent = 'Terminal';
    this._titleEl = title;

    const shell = document.createElement('span');
    shell.className = 'pane-shell';
    this._shellEl = shell;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pane-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClose(this);
    });

    header.append(status, title, shell);

    const termWrapper = document.createElement('div');
    termWrapper.className = 'pane-terminal';

    el.append(header, termWrapper);
    this.el = el;
    this._termWrapper = termWrapper;
    return el;
  }

  attachTerminal() {
    if (this.terminal && this._termWrapper && !this._attached) {
      this.terminal.attach(this._termWrapper);
      this._attached = true;
    }
  }

  setStatus(state) {
    if (!this._statusEl) return;
    this._statusEl.className = 'pane-status' + (state === 'ok' ? ' ok' : state === 'err' ? ' err' : '');
  }

  setShell(shell) { if (this._shellEl) this._shellEl.textContent = shell; }
  setTitle(title) { if (this._titleEl) this._titleEl.textContent = title || 'Terminal'; }

  focus() {
    this.el && this.el.classList.add('focused');
    this.terminal && this.terminal.focus();
  }

  blur() { this.el && this.el.classList.remove('focused'); }
}

class SplitTree {
  constructor(container, onFocusChange) {
    this._container = container;
    this._onFocusChange = onFocusChange || (() => {});
    this._root = null;
    this._focused = null;
    this._allPanes = [];
  }

  get focusedPane() { return this._focused; }

  init() {
    const pane = this._makePane();
    this._root = { kind: 'leaf', pane };

    this._container.innerHTML = '';
    this._container.className = 'split-node';
    this._container.append(pane.el);

    pane.attachTerminal();
    this._focusPane(pane);
    return pane;
  }

  splitPane(targetPane, dir, type, opts) {
    if (!this._findParentContainer(targetPane)) return null;

    const newPane = type === 'preview' ? this._makePreviewPane(opts) : this._makePane();
    const wrapper = this._buildSplitEl(dir);

    // Insert wrapper where targetPane.el currently lives
    const parent = targetPane.el.parentNode || this._container;
    parent.replaceChild(wrapper, targetPane.el);
    // Now build wrapper contents (targetPane.el was detached by replaceChild)
    const divider = this._makeDividerEl(wrapper, targetPane.el, newPane.el, dir, 0.5);
    wrapper.append(targetPane.el, divider, newPane.el);
    this._applyRatioToWrapper(wrapper, 0.5, dir);

    // Update tree model
    const splitNode = {
      kind: 'split', dir, ratio: 0.5,
      left: { kind: 'leaf', pane: targetPane },
      right: { kind: 'leaf', pane: newPane },
      el: wrapper,
    };
    this._replaceInTree(targetPane, splitNode);

    // First pass uses % fallback (wrapper not yet laid out).
    // After one frame the wrapper has real pixels — reapply for accurate sizing.
    requestAnimationFrame(() => {
      this._applyRatioToWrapper(wrapper, 0.5, dir);
      this._allPanes.forEach(p => p.terminal && p.terminal._refit());
    });

    if (newPane.terminal) newPane.attachTerminal();
    this._focusPane(newPane);
    return newPane;
  }

  closePane(pane) {
    if (this._allPanes.length === 1) return;

    // Find the split node that contains this pane and its sibling
    const sibling = this._getSibling(this._root, pane);
    if (!sibling) return;

    const splitNode = this._findSplitContaining(this._root, pane);
    if (!splitNode) return;

    // Get the sibling's subtree element
    const siblingEl = this._getNodeEl(sibling);

    // Replace splitNode.el in DOM with siblingEl
    const splitEl = splitNode.el;
    if (splitEl && splitEl.parentNode) {
      splitEl.parentNode.replaceChild(siblingEl, splitEl);
    } else {
      this._container.innerHTML = '';
      this._container.append(siblingEl);
    }

    // Clean up pane
    if (pane.terminal) pane.terminal.destroy();
    if (pane.preview) pane.preview.destroy();
    this._allPanes = this._allPanes.filter(p => p !== pane);

    // Update tree: replace split node with sibling subtree
    if (this._root.kind === 'split' && this._root.el === splitNode.el) {
      this._root = sibling;
    } else {
      this._replaceNodeInTree(this._root, splitNode, sibling);
    }

    // Refit all remaining terminals
    this._allPanes.forEach(p => p.terminal && p.terminal._refit());

    // Focus
    if (this._focused === pane) {
      const next = this._allPanes[this._allPanes.length - 1];
      if (next) this._focusPane(next);
    }
  }

  /** Re-apply all stored ratios using current pixel sizes. Call after window resize. */
  reapplyAllRatios() {
    const walk = (node) => {
      if (!node || node.kind === 'leaf') return;
      if (node.el) this._applyRatioToWrapper(node.el, node.ratio, node.dir);
      walk(node.left);
      walk(node.right);
    };
    walk(this._root);
    this._allPanes.forEach(p => p.terminal && p.terminal._refit());
  }

  destroyAll() {
    this._allPanes.forEach(p => p.terminal && p.terminal.destroy());
    this._allPanes = [];
    this._root = null;
    this._container.innerHTML = '';
  }

  // ── Private: pane creation ─────────────────────────────────

  _makePane() {
    const pane = new Pane();
    pane.buildEl((p) => this.closePane(p));
    pane.el.addEventListener('mousedown', () => this._focusPane(pane));

    const term = new Terminal(pane.id);
    pane.terminal = term;
    term.onConnect    = () => pane.setStatus('ok');
    term.onDisconnect = () => pane.setStatus('err');
    term.onShellInfo  = (s) => pane.setShell(s);
    term.onTitleChange= (t) => pane.setTitle(t);

    this._allPanes.push(pane);
    return pane;
  }

  _makePreviewPane(opts) {
    const pane = new Pane();
    pane.buildEl((p) => this.closePane(p));
    pane.el.addEventListener('mousedown', () => this._focusPane(pane));
    pane._titleEl.textContent = 'Preview';

    const preview = new PreviewPanel();
    preview.render(pane._termWrapper);
    preview.onClose = () => this.closePane(pane);
    pane.preview = preview;

    if (opts && opts.port) {
      preview.load(opts.port, opts.path || '/');
    }

    this._allPanes.push(pane);
    return pane;
  }

  _focusPane(pane) {
    if (this._focused) this._focused.blur();
    this._focused = pane;
    pane.focus();
    this._onFocusChange(pane);
  }

  // ── Private: DOM split construction ───────────────────────

  _buildSplitEl(dir) {
    const wrap = document.createElement('div');
    wrap.className = `split-node ${dir}`;
    wrap.style.flex = '1';
    return wrap;
  }

  _makeDividerEl(wrapper, leftEl, rightEl, dir, ratio) {
    const div = document.createElement('div');
    div.className = `split-divider ${dir}`;

    const overlay = document.getElementById('drag-overlay');
    let startPos, currentRatio;

    const onMove = (e) => {
      const pos = dir === 'horizontal' ? e.clientX : e.clientY;
      const delta = pos - startPos;
      const rect = wrapper.getBoundingClientRect();
      // divider itself is 8px, subtract from total
      const totalSize = (dir === 'horizontal' ? rect.width : rect.height) - 8;
      if (totalSize <= 0) return;
      currentRatio = Math.max(0.05, Math.min(0.95, currentRatio + delta / totalSize));
      startPos = pos;
      this._applyRatioToWrapper(wrapper, currentRatio, dir);
      const node = this._findNodeByEl(this._root, wrapper);
      if (node) node.ratio = currentRatio;
    };

    const onUp = () => {
      div.classList.remove('dragging');
      overlay.style.display = 'none';
      overlay.className = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this._allPanes.forEach(p => p.terminal && p.terminal._refit());
    };

    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Read current ratio from tree model
      const node = this._findNodeByEl(this._root, wrapper);
      currentRatio = node ? node.ratio : 0.5;
      startPos = dir === 'horizontal' ? e.clientX : e.clientY;
      div.classList.add('dragging');
      // Show overlay to capture all mouse events
      overlay.style.display = 'block';
      overlay.className = dir === 'horizontal' ? 'col-resize' : 'row-resize';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    div.addEventListener('dblclick', () => {
      currentRatio = 0.5;
      this._applyRatioToWrapper(wrapper, 0.5, dir);
      const node = this._findNodeByEl(this._root, wrapper);
      if (node) node.ratio = 0.5;
      this._allPanes.forEach(p => p.terminal && p.terminal._refit());
    });

    return div;
  }

  _applyRatioToWrapper(wrapper, ratio, dir) {
    const children = Array.from(wrapper.children).filter(c => !c.classList.contains('split-divider'));
    if (children.length < 2) return;

    // Use pixel-based flex-basis so nested split-nodes don't override with their own flex:1
    const rect = wrapper.getBoundingClientRect();
    const totalSize = (dir === 'horizontal' ? rect.width : rect.height) - 8; // 8px divider
    if (totalSize <= 0) {
      // Fallback to percentage if not yet laid out
      const pct = (ratio * 100).toFixed(3) + '%';
      const rem = ((1 - ratio) * 100).toFixed(3) + '%';
      const prop = dir === 'horizontal' ? 'width' : 'height';
      children[0].style.flex = `0 0 ${pct}`;
      children[0].style[prop] = pct;
      children[1].style.flex = `0 0 ${rem}`;
      children[1].style[prop] = rem;
      return;
    }

    const firstPx = Math.round(totalSize * ratio);
    const secondPx = totalSize - firstPx;
    const prop = dir === 'horizontal' ? 'width' : 'height';
    const cross = dir === 'horizontal' ? 'height' : 'width';

    children[0].style.flex = `0 0 ${firstPx}px`;
    children[0].style[prop] = `${firstPx}px`;
    children[0].style[cross] = '';
    children[1].style.flex = `0 0 ${secondPx}px`;
    children[1].style[prop] = `${secondPx}px`;
    children[1].style[cross] = '';
  }

  // ── Private: tree traversal ────────────────────────────────

  _findParentContainer(pane) {
    // Returns true if pane exists in tree
    const find = (node) => {
      if (!node) return false;
      if (node.kind === 'leaf') return node.pane === pane;
      return find(node.left) || find(node.right);
    };
    return find(this._root);
  }

  _replaceInTree(targetPane, replacement) {
    if (this._root.kind === 'leaf' && this._root.pane === targetPane) {
      this._root = replacement;
      return;
    }
    const replace = (node) => {
      if (!node || node.kind === 'leaf') return;
      if (node.left.kind === 'leaf' && node.left.pane === targetPane) { node.left = replacement; return; }
      if (node.right.kind === 'leaf' && node.right.pane === targetPane) { node.right = replacement; return; }
      replace(node.left);
      replace(node.right);
    };
    replace(this._root);
  }

  _getSibling(node, pane) {
    if (!node || node.kind === 'leaf') return null;
    if (node.left.kind === 'leaf' && node.left.pane === pane) return node.right;
    if (node.right.kind === 'leaf' && node.right.pane === pane) return node.left;
    return this._getSibling(node.left, pane) || this._getSibling(node.right, pane);
  }

  _findSplitContaining(node, pane) {
    if (!node || node.kind === 'leaf') return null;
    if ((node.left.kind === 'leaf' && node.left.pane === pane) ||
        (node.right.kind === 'leaf' && node.right.pane === pane)) return node;
    return this._findSplitContaining(node.left, pane) || this._findSplitContaining(node.right, pane);
  }

  _getNodeEl(node) {
    if (node.kind === 'leaf') return node.pane.el;
    return node.el;
  }

  _replaceNodeInTree(current, target, replacement) {
    if (!current || current.kind === 'leaf') return;
    if (current.left === target) { current.left = replacement; return; }
    if (current.right === target) { current.right = replacement; return; }
    this._replaceNodeInTree(current.left, target, replacement);
    this._replaceNodeInTree(current.right, target, replacement);
  }

  _findNodeByEl(node, el) {
    if (!node || node.kind === 'leaf') return null;
    if (node.el === el) return node;
    return this._findNodeByEl(node.left, el) || this._findNodeByEl(node.right, el);
  }
}
