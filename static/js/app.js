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

  tabs.newTab();

  const mobileKb = new MobileKeyboard(() => tabs.activeTerminal());
  mobileKb.mount();

  const kbBtn = document.getElementById('kb-toggle-btn');
  if (kbBtn) {
    kbBtn.addEventListener('click', () => mobileKb.toggle());
    makeDraggable(kbBtn);
  }
});

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
