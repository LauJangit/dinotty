// Preview Panel - manages iframe-based web preview
class PreviewPanel {
  constructor() {
    this.port = null;
    this.path = '/';
    this.el = null;
    this.iframe = null;
    this.addressInput = null;
    this.deviceWidth = null; // null = 100%
    this.history = [];
    this.historyIndex = -1;
  }

  render(container) {
    this.el = document.createElement('div');
    this.el.className = 'preview-panel';
    this.el.innerHTML = `
      <div class="preview-toolbar">
        <button class="prev-back" title="Back">←</button>
        <button class="prev-fwd" title="Forward">→</button>
        <button class="prev-refresh" title="Refresh">↻</button>
        <div class="preview-address-bar">
          <input type="text" placeholder=":port/path" spellcheck="false">
        </div>
        <button class="prev-fullscreen" title="Fullscreen">⊡</button>
        <button class="prev-close" title="Close">✕</button>
      </div>
      <div class="preview-devices">
        <button data-width="375">375</button>
        <button data-width="393">393</button>
        <button data-width="430">430</button>
        <button data-width="768">768</button>
        <button data-width="1024">1024</button>
        <button data-width="" class="active">100%</button>
      </div>
      <div class="preview-iframe-container">
        <iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
      </div>
    `;
    container.appendChild(this.el);

    this.iframe = this.el.querySelector('iframe');
    this.addressInput = this.el.querySelector('.preview-address-bar input');

    this.el.querySelector('.prev-back').onclick = () => this._goBack();
    this.el.querySelector('.prev-fwd').onclick = () => this._goForward();
    this.el.querySelector('.prev-refresh').onclick = () => this._refresh();
    this.el.querySelector('.prev-close').onclick = () => this._close();
    this.el.querySelector('.prev-fullscreen').onclick = () => this._toggleFullscreen();

    this.addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._navigateFromInput();
      }
    });

    this.el.querySelectorAll('.preview-devices button').forEach(btn => {
      btn.onclick = () => this._setDeviceWidth(btn);
    });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'preview-error') {
        console.warn('[Preview]', e.data.message, e.data.source, e.data.line);
      }
    });
  }

  load(port, path) {
    this.port = port;
    this.path = path || '/';
    const url = `/preview/${this.port}${this.path}`;
    this.addressInput.value = `:${this.port}${this.path}`;
    this.iframe.src = url;
    this._pushHistory(port, this.path);
  }

  _navigateFromInput() {
    const val = this.addressInput.value.trim();
    let port, path;
    const m = val.match(/^:?(\d+)(\/.*)?$/);
    if (m) {
      port = parseInt(m[1]);
      path = m[2] || '/';
    } else if (val.startsWith('/')) {
      port = this.port;
      path = val;
    } else {
      return;
    }
    if (port) this.load(port, path);
  }

  _refresh() {
    if (this.iframe.src) {
      this.iframe.src = this.iframe.src;
    }
  }

  _goBack() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const entry = this.history[this.historyIndex];
      this.port = entry.port;
      this.path = entry.path;
      this.addressInput.value = `:${entry.port}${entry.path}`;
      this.iframe.src = `/preview/${entry.port}${entry.path}`;
    }
  }

  _goForward() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const entry = this.history[this.historyIndex];
      this.port = entry.port;
      this.path = entry.path;
      this.addressInput.value = `:${entry.port}${entry.path}`;
      this.iframe.src = `/preview/${entry.port}${entry.path}`;
    }
  }

  _pushHistory(port, path) {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push({ port, path });
    this.historyIndex = this.history.length - 1;
  }

  _setDeviceWidth(btn) {
    this.el.querySelectorAll('.preview-devices button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const w = btn.dataset.width;
    if (w) {
      this.iframe.style.width = w + 'px';
      this.iframe.style.maxWidth = '100%';
    } else {
      this.iframe.style.width = '100%';
      this.iframe.style.maxWidth = '';
    }
  }

  _toggleFullscreen() {
    if (this.el.classList.contains('preview-fullscreen')) {
      this.el.classList.remove('preview-fullscreen');
    } else {
      this.el.classList.add('preview-fullscreen');
    }
  }

  _close() {
    if (this.onClose) this.onClose();
  }

  destroy() {
    if (this.iframe) this.iframe.src = 'about:blank';
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}

// Global preview opener — called from terminal link handler
function openPreview(port, path) {
  console.log('[Preview] openPreview called:', port, path);
  const activePage = document.querySelector('.tab-page.active');
  if (!activePage) {
    console.error('[Preview] No active tab page found');
    return;
  }

  // If there's already a preview in this tab, just navigate it
  const existing = activePage.querySelector('.preview-panel');
  if (existing && existing._previewInstance) {
    existing._previewInstance.load(port, path || '/');
    return;
  }

  // Create split layout: terminal on left/top, preview on right/bottom
  const isLandscape = window.innerWidth > window.innerHeight;
  const dir = isLandscape ? 'horizontal' : 'vertical';

  // Wrap existing content
  const termWrapper = document.createElement('div');
  termWrapper.className = 'preview-split-child';
  while (activePage.firstChild) {
    termWrapper.appendChild(activePage.firstChild);
  }

  const divider = document.createElement('div');
  divider.className = `preview-split-divider ${dir}`;

  const previewWrapper = document.createElement('div');
  previewWrapper.className = 'preview-split-child';

  activePage.className = activePage.className + ` preview-split ${dir}`;
  activePage.append(termWrapper, divider, previewWrapper);

  const panel = new PreviewPanel();
  panel.render(previewWrapper);
  panel.load(port, path || '/');
  previewWrapper.querySelector('.preview-panel')._previewInstance = panel;

  panel.onClose = () => {
    // Restore original layout
    activePage.className = activePage.className.replace(/ preview-split( horizontal| vertical)/g, '');
    divider.remove();
    previewWrapper.remove();
    while (termWrapper.firstChild) {
      activePage.appendChild(termWrapper.firstChild);
    }
    termWrapper.remove();
    panel.destroy();
    // Refit terminal
    const term = activePage.querySelector('.xterm');
    if (term) {
      window.dispatchEvent(new Event('resize'));
    }
  };

  // Divider drag
  _setupDividerDrag(divider, termWrapper, previewWrapper, dir);

  // Refit terminal after split
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function _setupDividerDrag(divider, leftEl, rightEl, dir) {
  let startPos, startLeftSize;

  const onMove = (e) => {
    const pos = dir === 'horizontal' ? e.clientX : e.clientY;
    const parent = divider.parentElement;
    const rect = parent.getBoundingClientRect();
    const total = (dir === 'horizontal' ? rect.width : rect.height) - 8;
    const offset = pos - (dir === 'horizontal' ? rect.left : rect.top);
    const ratio = Math.max(0.15, Math.min(0.85, offset / (total + 8)));
    const leftPx = Math.round(total * ratio);
    const rightPx = total - leftPx;
    const prop = dir === 'horizontal' ? 'width' : 'height';
    leftEl.style.flex = `0 0 ${leftPx}px`;
    rightEl.style.flex = `0 0 ${rightPx}px`;
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.dispatchEvent(new Event('resize'));
  };

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

window.PreviewPanel = PreviewPanel;
window.openPreview = openPreview;
