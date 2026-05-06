let _tabSeq = 0;

function _genPaneId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

class TabManager {
  constructor(tabsList, content) {
    this._tabsList = tabsList;
    this._content  = content;
    this._tabs     = [];
    this._active   = null;
    this._syncWs   = null;
    this._suppressSync = false;
  }

  setSyncWs(ws) {
    this._syncWs = ws;
  }

  _sendSync(msg) {
    if (this._syncWs && this._syncWs.readyState === WebSocket.OPEN && !this._suppressSync) {
      this._syncWs.send(JSON.stringify(msg));
    }
  }

  _persist() {
    const state = this._tabs.map(t => ({
      paneId: t.paneId,
      title: t.labelEl.querySelector('.tab-title').textContent,
    }));
    const activeIdx = this._tabs.indexOf(this._active);
    localStorage.setItem('xterm_tabs', JSON.stringify({ tabs: state, activeIdx }));
  }

  restore() {
    const raw = localStorage.getItem('xterm_tabs');
    if (!raw) return false;
    try {
      const { tabs, activeIdx } = JSON.parse(raw);
      if (!tabs || !tabs.length) return false;
      for (const t of tabs) {
        this._createTab(t.paneId, t.title);
      }
      const idx = Math.min(activeIdx || 0, this._tabs.length - 1);
      this.activateTab(this._tabs[idx]);
      return true;
    } catch { return false; }
  }

  newTab() {
    const paneId = _genPaneId();
    const tab = this._createTab(paneId, 'Terminal');
    this._sendSync({ type: 'create_tab', pane_id: paneId });
    this._persist();
    return tab;
  }

  _createTab(paneId, title) {
    const id = `tab-${++_tabSeq}`;

    // Tab button
    const labelEl = document.createElement('div');
    labelEl.className = 'tab';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = title || 'Terminal';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.closeTab(tab); });

    labelEl.append(titleSpan, closeBtn);
    labelEl.addEventListener('click', () => this.activateTab(tab));
    this._tabsList.append(labelEl);

    // Terminal wrapper page
    const pageEl = document.createElement('div');
    pageEl.className = 'tab-page';
    this._content.append(pageEl);

    // Terminal instance
    const term = new Terminal(paneId);
    term.onTitleChange = (t) => { titleSpan.textContent = t || 'Terminal'; this._persist(); };

    const tab = { id, paneId, labelEl, pageEl, term };
    this._tabs.push(tab);
    this._activateTabInternal(tab);

    // Attach after page is in DOM and visible
    requestAnimationFrame(() => {
      term.attach(pageEl);
    });

    return tab;
  }

  closeTab(tab) {
    if (this._tabs.length === 1) {
      tab.term.destroy();
      tab.pageEl.innerHTML = '';
      this._sendSync({ type: 'close_tab', pane_id: tab.paneId });
      const newPaneId = _genPaneId();
      const newTerm = new Terminal(newPaneId);
      tab.paneId = newPaneId;
      tab.term = newTerm;
      tab.labelEl.querySelector('.tab-title').textContent = 'Terminal';
      newTerm.onTitleChange = (t) => { tab.labelEl.querySelector('.tab-title').textContent = t || 'Terminal'; this._persist(); };
      requestAnimationFrame(() => newTerm.attach(tab.pageEl));
      this._sendSync({ type: 'create_tab', pane_id: newPaneId });
      this._persist();
      return;
    }

    const idx = this._tabs.indexOf(tab);
    const paneId = tab.paneId;
    tab.term.destroy();
    tab.labelEl.remove();
    tab.pageEl.remove();
    this._tabs.splice(idx, 1);

    if (this._active === tab) {
      this._active = null;
      this.activateTab(this._tabs[Math.min(idx, this._tabs.length - 1)]);
    }
    this._sendSync({ type: 'close_tab', pane_id: paneId });
    this._persist();
  }

  _activateTabInternal(tab) {
    if (this._active) {
      this._active.labelEl.classList.remove('active');
      this._active.pageEl.classList.remove('active');
    }
    this._active = tab;
    tab.labelEl.classList.add('active');
    tab.pageEl.classList.add('active');
    tab.term.focus();
    requestAnimationFrame(() => tab.term.fit());
  }

  activateTab(tab) {
    this._activateTabInternal(tab);
    this._sendSync({ type: 'activate_tab', pane_id: tab.paneId });
    this._persist();
  }

  switchToIndex(idx) {
    const tab = this._tabs[idx];
    if (tab) { this.activateTab(tab); return true; }
    return false;
  }

  closeActiveTab() {
    if (this._active) this.closeTab(this._active);
  }

  activeTerminal() {
    return this._active ? this._active.term : null;
  }

  getAllPaneIds() {
    return this._tabs.map(t => t.paneId);
  }

  _getSavedTitle(paneId) {
    try {
      const raw = localStorage.getItem('xterm_tabs');
      if (!raw) return null;
      const { tabs } = JSON.parse(raw);
      const t = tabs && tabs.find(t => t.paneId === paneId);
      return t ? t.title : null;
    } catch { return null; }
  }

  hasPaneId(paneId) {
    return this._tabs.some(t => t.paneId === paneId);
  }

  activateByPaneId(paneId) {
    const tab = this._tabs.find(t => t.paneId === paneId);
    if (tab && tab !== this._active) {
      this._suppressSync = true;
      this.activateTab(tab);
      this._suppressSync = false;
    }
  }

  addRemoteTab(paneId) {
    this._suppressSync = true;
    const saved = this._getSavedTitle(paneId);
    const tab = this._createTab(paneId, saved || 'Terminal');
    this._suppressSync = false;
    return tab;
  }

  removeByPaneId(paneId) {
    const tab = this._tabs.find(t => t.paneId === paneId);
    if (!tab) return;
    if (this._tabs.length === 1) return;
    const idx = this._tabs.indexOf(tab);
    tab.term.destroy();
    tab.labelEl.remove();
    tab.pageEl.remove();
    this._tabs.splice(idx, 1);
    if (this._active === tab) {
      this._active = null;
      this.activateTab(this._tabs[Math.min(idx, this._tabs.length - 1)]);
    }
    this._persist();
  }
}
