#!/usr/bin/env node
// Repro: A refreshes -> B misaligned + can't input.
//
// Two clients (A, B) on the same pane with DIFFERENT viewport sizes.
// A refreshes while high output is flowing. After A reconnects it forces
// its local size on the PTY. B follows via peer-follow, then refits to
// its own wrapper after 500ms - but the "don't ping-pong" guard prevents
// B from re-sending, so the PTY stays at A's size while B's display is
// at B's size. B is misaligned with the PTY.
//
// We detect misalignment via pixel sizes: after peer-follow expires,
// if B's xterm-screen doesn't match A's xterm-screen (different cols/rows),
// and B's screen doesn't fill B's wrapper, B is misaligned.
//
// We also probe P1 (write pump death): under high output, send a marker
// via B and check if it's echoed. If not, B's write pump is dead.
//
// Run:
//   DINOTTY_TOKEN=<token> node scripts/repro-resize-misalign.mjs
// Optional:
//   DINOTTY_URL  default http://127.0.0.1:38999
//   HEADED=1     show browser windows
//   KEEP_OPEN=1  don't close at end

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:38999'
const TOKEN = process.env.DINOTTY_TOKEN
const HEADED = !!process.env.HEADED
const CHROME = !!process.env.CHROME
const KEEP_OPEN = !!process.env.KEEP_OPEN

if (!TOKEN) {
  console.error('error: DINOTTY_TOKEN env var is required')
  process.exit(2)
}

const step = (name) => console.log(`\n[step] ${name}`)

async function waitForTerminalApi(page) {
  await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })
}

async function loginAndOpen(browser, label) {
  const ctx = await browser.newContext()
  const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
  if (!resp.ok()) {
    throw new Error(`[${label}] login failed: ${resp.status()} ${await resp.text()}`)
  }
  const page = await ctx.newPage()
  const wsFrames = []
  page.on('websocket', ws => {
    ws.on('framereceived', frame => {
      if (typeof frame.payload === 'string') wsFrames.push({ url: ws.url(), payload: frame.payload })
    })
  })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitForTerminalApi(page)
  return { ctx, page, wsFrames, label }
}

async function stabilizePanes(page) {
  let last = -1
  for (let i = 0; i < 20; i++) {
    const c = await page.evaluate(() => window.__dinotty_terminal_api.listPanes().length)
    if (c === last) break
    last = c
    await page.waitForTimeout(200)
  }
}

async function createTab(page, ctx) {
  const before = await page.evaluate(() => window.__dinotty_terminal_api.listPanes().map(p => p.id))
  await page.evaluate(async () => { await window.__dinotty_terminal_api.createTab() })
  const paneId = await page.evaluate(async (beforeArr) => {
    const beforeSet = new Set(beforeArr)
    for (let i = 0; i < 80; i++) {
      const panes = window.__dinotty_terminal_api.listPanes()
      if (panes.length > beforeArr.length) {
        const fresh = panes.find(p => !beforeSet.has(p.id))
        if (fresh) return fresh.id
      }
      await new Promise(r => setTimeout(r, 100))
    }
    return null
  }, before)
  const tabsResp = await ctx.request.get(`${URL}/api/tabs`)
  if (tabsResp.ok()) {
    const body = await tabsResp.json()
    const tab = (body.tabs ?? []).find(t => JSON.stringify(t.layout ?? t).includes(paneId))
    if (tab) await ctx.request.put(`${URL}/api/tabs/${tab.id ?? tab.tab_id}/pane/${paneId}/activate`)
  }
  return paneId
}

async function activatePane(ctx, page, paneId) {
  const tabsResp = await ctx.request.get(`${URL}/api/tabs`)
  if (!tabsResp.ok()) return
  const body = await tabsResp.json()
  const tab = (body.tabs ?? []).find(t => JSON.stringify(t.layout ?? t).includes(paneId))
  if (!tab) return
  await ctx.request.put(`${URL}/api/tabs/${tab.id ?? tab.tab_id}/pane/${paneId}/activate`)
  await page.waitForFunction((pid) => {
    return window.__dinotty_terminal_api.listPanes().some(p => p.id === pid && p.active)
  }, paneId, { timeout: 5000 }).catch(() => {})
}

async function sendToPane(page, paneId, data) {
  await page.evaluate(({pid, d}) => {
    window.__dinotty_terminal_api.send(pid, d)
  }, {pid: paneId, d: data})
}

async function waitForXtermFit(page) {
  await page.waitForFunction(() => {
    const containers = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const visible = containers.find(c => {
      const r = c.getBoundingClientRect()
      return r.width > 10 && r.height > 10
    })
    if (!visible) return false
    const wrapper = visible.querySelector('.terminal-pane')
    const screen = visible.querySelector('.xterm-screen')
    if (!wrapper || !screen) return false
    const w = wrapper.getBoundingClientRect()
    const s = screen.getBoundingClientRect()
    if (s.width < 10 || s.height < 10) return false
    return Math.abs(w.width - s.width) < 50 && Math.abs(w.height - s.height) < 50
  }, { timeout: 15000 })
}

// Read pixel sizes + textarea focus for the visible pane.
async function readTerminalState(page) {
  return await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const container = containers.find(c => {
      const r = c.getBoundingClientRect()
      return r.width > 10 && r.height > 10
    })
    if (!container) return { error: 'no visible container' }
    const wrapper = container.querySelector('.terminal-pane')
    const screen = container.querySelector('.xterm-screen')
    const viewport = container.querySelector('.xterm-viewport')
    const textarea = container.querySelector('.xterm-helper-textarea')
    if (!wrapper || !screen) return { error: 'xterm not ready' }
    const wrapperRect = wrapper.getBoundingClientRect()
    const screenRect = screen.getBoundingClientRect()
    const THRESH = 10
    const dw = Math.abs(wrapperRect.width - screenRect.width)
    const dh = Math.abs(wrapperRect.height - screenRect.height)
    return {
      wrapper: { w: Math.round(wrapperRect.width), h: Math.round(wrapperRect.height) },
      screen: { w: Math.round(screenRect.width), h: Math.round(screenRect.height) },
      delta: { dw: Math.round(dw), dh: Math.round(dh) },
      fills: dw < THRESH && dh < THRESH,
      scrollTop: Math.round(viewport?.scrollTop ?? 0),
      scrollHeight: Math.round(viewport?.scrollHeight ?? 0),
      textareaFocused: textarea === document.activeElement,
    }
  })
}

function scanWs(wsFrames, needle) {
  return wsFrames.some(f => f.payload.includes(needle))
}

async function measureMarkerRoundTrip(page, wsFrames, paneId, marker) {
  const start = Date.now()
  await sendToPane(page, paneId, `echo ${marker}\n`)
  while (Date.now() - start < 5000) {
    if (scanWs(wsFrames, marker)) {
      return Date.now() - start
    }
    await page.waitForTimeout(50)
  }
  return -1
}

async function closeTabByPaneId(ctx, paneId) {
  try {
    const resp = await ctx.request.get(`${URL}/api/tabs`)
    if (!resp.ok()) return
    const body = await resp.json()
    for (const t of (body.tabs ?? [])) {
      if (JSON.stringify(t.layout ?? t).includes(paneId)) {
        await ctx.request.delete(`${URL}/api/tabs/${t.id ?? t.tab_id}`)
        return
      }
    }
  } catch {}
}

async function main() {
  console.log(`target: ${URL}`)
  console.log(`headed: ${HEADED}  chrome: ${CHROME}`)

  const browser = await chromium.launch({ headless: !HEADED, channel: CHROME ? 'chrome' : undefined })
  const A = await loginAndOpen(browser, 'A')
  const B = await loginAndOpen(browser, 'B')
  let testPaneId = null

  try {
    step('A creates a fresh test tab; B mirrors via sync WS')
    await stabilizePanes(A.page)
    testPaneId = await createTab(A.page, A.ctx)
    if (!testPaneId) { console.log('FATAL: no pane'); process.exit(3) }
    console.log(`  test paneId: ${testPaneId}`)

    await B.page.waitForFunction((pid) => {
      return window.__dinotty_terminal_api.listPanes().some(p => p.id === pid)
    }, testPaneId, { timeout: 10000 })
    console.log('  B mirrored the pane')

    step('set DIFFERENT viewport sizes so A and B have different natural cols/rows')
    // A: smaller -> fewer cols/rows
    await A.page.setViewportSize({ width: 700, height: 450 })
    // B: larger -> more cols/rows
    await B.page.setViewportSize({ width: 1400, height: 900 })
    await activatePane(A.ctx, A.page, testPaneId)
    await activatePane(A.ctx, B.page, testPaneId)
    await waitForXtermFit(A.page)
    await waitForXtermFit(B.page)
    await A.page.waitForTimeout(800)
    await B.page.waitForTimeout(800)

    const aState0 = await readTerminalState(A.page)
    const bState0 = await readTerminalState(B.page)
    console.log(`  A: wrapper=${aState0.wrapper?.w}x${aState0.wrapper?.h} screen=${aState0.screen?.w}x${aState0.screen?.h} fills=${aState0.fills}`)
    console.log(`  B: wrapper=${bState0.wrapper?.w}x${bState0.wrapper?.h} screen=${bState0.screen?.w}x${bState0.screen?.h} fills=${bState0.fills}`)

    step('baseline: B can echo a marker')
    const baseMarker = 'BASE_' + Date.now()
    const baseLat = await measureMarkerRoundTrip(B.page, B.wsFrames, testPaneId, baseMarker)
    console.log(`  B baseline marker latency: ${baseLat}ms ${baseLat > 0 ? 'OK' : 'FAILED'}`)

    step('start high output on the pane (yes) to simulate Claude running')
    await sendToPane(A.page, testPaneId, 'yes\n')
    await A.page.waitForTimeout(2000)
    const aOutFrames = A.wsFrames.length
    const bOutFrames = B.wsFrames.length
    await A.page.waitForTimeout(1000)
    console.log(`  A received ${A.wsFrames.length - aOutFrames} output frames in 1s`)
    console.log(`  B received ${B.wsFrames.length - bOutFrames} output frames in 1s`)

    step('A refreshes WHILE high output is flowing')
    const bFramesBefore = B.wsFrames.length
    await A.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForTerminalApi(A.page)
    await waitForXtermFit(A.page)
    await A.page.waitForTimeout(2000)

    const aState1 = await readTerminalState(A.page)
    console.log(`  A after reconnect: wrapper=${aState1.wrapper?.w}x${aState1.wrapper?.h} screen=${aState1.screen?.w}x${aState1.screen?.h} fills=${aState1.fills}`)

    step('sample B state at multiple timepoints after A refresh')
    const samples = []
    for (const t of [0, 300, 600, 1200, 2000, 3000, 5000]) {
      const target = Date.now()
      await B.page.waitForTimeout(t === 0 ? 0 : t - (Date.now() - (samples[0]?.clock ?? Date.now())))
      const s = await readTerminalState(B.page)
      const clock = Date.now()
      samples.push({ t, clock, state: s })
      console.log(`  B t+${t}ms: wrapper=${s.wrapper?.w}x${s.wrapper?.h} screen=${s.screen?.w}x${s.screen?.h} fills=${s.fills} scrollTop=${s.scrollTop}`)
    }

    // Also stop the yes output
    await sendToPane(B.page, testPaneId, '\x03')
    await B.page.waitForTimeout(500)

    const bFinal = samples[samples.length - 1].state
    const aFinal = aState1

    step('post-refresh: can B echo a marker?')
    const postMarker = 'POST_' + Date.now()
    const postLat = await measureMarkerRoundTrip(B.page, B.wsFrames, testPaneId, postMarker)
    console.log(`  B post-refresh marker latency: ${postLat}ms ${postLat > 0 ? 'OK' : 'FAILED'}`)

    // Check if B's screen size matches A's screen size (same cols/rows)
    const sameScreenSize = bFinal.screen?.w === aFinal.screen?.w && bFinal.screen?.h === aFinal.screen?.h
    const bFillsWrapper = bFinal.fills
    const bReceivedOutput = B.wsFrames.length - bFramesBefore > 10

    step('verdict')
    console.log('\n========== VERDICT (resize misalign) ==========')
    console.log(`A screen:  ${aFinal.screen?.w}x${aFinal.screen?.h} (A forced this on PTY)`)
    console.log(`B screen:  ${bFinal.screen?.w}x${bFinal.screen?.h} (after peer-follow settle)`)
    console.log(`B wrapper: ${bFinal.wrapper?.w}x${bFinal.wrapper?.h}`)
    console.log(`B screen == A screen (same cols/rows): ${sameScreenSize ? 'yes' : 'NO'}`)
    console.log(`B fills its wrapper: ${bFillsWrapper ? 'yes' : 'NO'}`)
    console.log(`B received output after A refresh: ${bReceivedOutput ? 'yes' : 'NO'}`)
    console.log(`B baseline echo: ${baseLat > 0 ? 'works' : 'FAILED'}`)
    console.log(`B post-refresh echo: ${postLat > 0 ? 'works' : 'FAILED'}`)

    const misaligned = !sameScreenSize && !bFillsWrapper
    if (misaligned && postLat < 0) {
      console.log('=> REPRODUCED: B misaligned AND input dead (resize misalign + P1)')
    } else if (misaligned && postLat > 0) {
      console.log('=> PARTIAL: B misaligned but input still works')
    } else if (!misaligned && postLat < 0) {
      console.log('=> PARTIAL: B aligned but input dead (P1 only)')
    } else if (!misaligned && postLat > 0) {
      console.log('=> NOT reproduced: B aligned and input works')
    } else {
      console.log('=> ambiguous - inspect metrics above')
    }
    console.log('================================================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - leaving browser open. Press Ctrl+C to exit.')
      await new Promise(() => {})
    }
  } finally {
    if (testPaneId) {
      // stop yes if still running
      await sendToPane(A.page, testPaneId, '\x03').catch(() => {})
      await closeTabByPaneId(A.ctx, testPaneId).catch(() => {})
    }
    await A.ctx.close()
    await B.ctx.close()
    if (!KEEP_OPEN) await browser.close()
  }
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
