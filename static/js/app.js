document.addEventListener('DOMContentLoaded', () => {
  const tabsList   = document.getElementById('tabs-list');
  const tabContent = document.getElementById('tab-content');
  const tabNewBtn  = document.getElementById('tab-new-btn');

  const paletteBackdrop = document.getElementById('palette-backdrop');
  const paletteInput    = document.getElementById('palette-input');
  const paletteList     = document.getElementById('palette-list');

  const tabs    = new TabManager(tabsList, tabContent);
  const palette = new CommandPalette(paletteBackdrop, paletteInput, paletteList);

  palette.setCommands([
    {
      icon: '＋', title: 'New Tab',
      subtitle: 'Open a new terminal tab',
      kbd: ['⌘', 'T'],
      action: () => tabs.newTab(),
    },
    {
      icon: '✕', title: 'Close Tab',
      subtitle: 'Close the current tab',
      kbd: ['⌘', 'W'],
      action: () => tabs.closeActiveTab(),
    },
  ]);

  tabNewBtn.addEventListener('click', () => tabs.newTab());

  document.addEventListener('keydown', (e) => {
    const cmd   = e.metaKey || e.ctrlKey;
    const shift = e.shiftKey;

    if (!cmd) return;

    if (e.key === 'k' && !shift) { e.preventDefault(); palette.toggle(); return; }
    if (e.key === 't' && !shift) { e.preventDefault(); tabs.newTab(); return; }
    if (e.key === 'w' && !shift) { e.preventDefault(); tabs.closeActiveTab(); return; }

    // Cmd+1..9 switch tab
    if (!shift && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (tabs.switchToIndex(idx)) e.preventDefault();
    }
  });

  // Don't restore from localStorage — let sync WS provide the tab list
  // tabs.newTab() will be called if server has no tabs
  connectSyncWS(tabs);

  const mobileKb = new MobileKeyboard(() => tabs.activeTerminal());
  mobileKb.mount();

  const kbBtn = document.getElementById('kb-toggle-btn');
  if (kbBtn) {
    kbBtn.addEventListener('click', () => mobileKb.toggle());
    makeDraggable(kbBtn);
  }
});

function connectSyncWS(tabs) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/sync`;
  let ws = new WebSocket(url);

  ws.onopen = () => {
    tabs.setSyncWs(ws);
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'tab_list') {
      const localPaneIds = new Set(tabs.getAllPaneIds());
      for (const tab of msg.tabs) {
        if (!localPaneIds.has(tab.pane_id)) {
          tabs.addRemoteTab(tab.pane_id);
        }
      }
      tabs._persist();
      for (const localId of localPaneIds) {
        if (!msg.tabs.find(t => t.pane_id === localId)) {
          tabs.removeByPaneId(localId);
        }
      }
      if (msg.active_pane_id) {
        tabs.activateByPaneId(msg.active_pane_id);
      }
      // If server has no tabs and we have none locally, create one
      if (msg.tabs.length === 0 && tabs.getAllPaneIds().length === 0) {
        tabs.newTab();
      }
    } else if (msg.type === 'tab_created') {
      if (!tabs.hasPaneId(msg.pane_id)) {
        tabs.addRemoteTab(msg.pane_id);
      }
    } else if (msg.type === 'tab_closed') {
      tabs.removeByPaneId(msg.pane_id);
    } else if (msg.type === 'tab_activated') {
      tabs.activateByPaneId(msg.pane_id);
    }
  };

  ws.onclose = () => {
    tabs.setSyncWs(null);
    setTimeout(() => connectSyncWS(tabs), 2000);
  };

  ws.onerror = () => {};
}

function makeDraggable(el) {
  let startX, startY, startRight, startBottom, dragged;

  const onStart = (clientX, clientY) => {
    dragged = false;
    const rect = el.getBoundingClientRect();
    startX = clientX;
    startY = clientY;
    startRight  = window.innerWidth  - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    el.style.transition = 'none';
  };

  const onMove = (clientX, clientY) => {
    const dx = Math.abs(clientX - startX) + Math.abs(clientY - startY);
    if (dx > 4) dragged = true;
    if (!dragged) return;
    const newRight  = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  startRight  - (clientX - startX)));
    const newBottom = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startBottom - (clientY - startY)));
    el.style.right  = newRight  + 'px';
    el.style.bottom = newBottom + 'px';
  };

  const onEnd = () => { el.style.transition = ''; };

  // Touch
  el.addEventListener('touchstart', e => { const t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchmove',  e => { const t = e.touches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend',   onEnd);

  // Mouse
  el.addEventListener('mousedown', e => { onStart(e.clientX, e.clientY); });
  window.addEventListener('mousemove', e => { if (dragged !== undefined) onMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup',   () => { if (dragged !== undefined) { onEnd(); dragged = undefined; } });
}
