let _tabSeq = 0;

class TabManager {
  constructor(tabsList, content) {
    this._tabsList = tabsList;
    this._content  = content;
    this._tabs     = [];
    this._active   = null;
  }

  newTab() {
    const id = `tab-${++_tabSeq}`;

    // Tab button
    const labelEl = document.createElement('div');
    labelEl.className = 'tab';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = 'Terminal';

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
    const term = new Terminal(id);
    term.onTitleChange = (t) => { titleSpan.textContent = t || 'Terminal'; };

    const tab = { id, labelEl, pageEl, term };
    this._tabs.push(tab);
    this.activateTab(tab);

    // Attach after page is in DOM and visible
    requestAnimationFrame(() => {
      term.attach(pageEl);
    });

    return tab;
  }

  closeTab(tab) {
    if (this._tabs.length === 1) {
      // Last tab — replace with a fresh terminal using a new id
      tab.term.destroy();
      tab.pageEl.innerHTML = '';
      const newId = `tab-${++_tabSeq}`;
      const newTerm = new Terminal(newId);
      tab.id   = newId;
      tab.term = newTerm;
      tab.labelEl.querySelector('.tab-title').textContent = 'Terminal';
      newTerm.onTitleChange = (t) => { tab.labelEl.querySelector('.tab-title').textContent = t || 'Terminal'; };
      requestAnimationFrame(() => newTerm.attach(tab.pageEl));
      return;
    }

    const idx = this._tabs.indexOf(tab);
    tab.term.destroy();
    tab.labelEl.remove();
    tab.pageEl.remove();
    this._tabs.splice(idx, 1);

    if (this._active === tab) {
      this._active = null;
      this.activateTab(this._tabs[Math.min(idx, this._tabs.length - 1)]);
    }
  }

  activateTab(tab) {
    if (this._active) {
      this._active.labelEl.classList.remove('active');
      this._active.pageEl.classList.remove('active');
    }
    this._active = tab;
    tab.labelEl.classList.add('active');
    tab.pageEl.classList.add('active');
    tab.term.focus();
    // Page was hidden (display:none) while inactive, so fitAddon couldn't
    // measure correctly. Refit now that the element is visible.
    requestAnimationFrame(() => tab.term.fit());
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
}
