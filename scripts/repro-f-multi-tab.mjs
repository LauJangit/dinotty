#!/usr/bin/env node
// Repro script for F suspect: multiple tabs' xterm instances all run
// _processWriteQueue concurrently. Background tabs' PTY output keeps their
// xterm.write() + rAF chain running, starving the foreground tab's wheel
// events and input handling on the main thread.
//
// Setup: 4 tabs in ONE page. tab0 = foreground (active). tab1/2/3 = background.
// Measure on tab0:
//   1. rAF frame intervals (60 frames) - healthy ~16ms, starved >> 16ms
//   2. echo marker round-trip latency via WS frames
// Compare:
//   baseline: tab1/2/3 idle (no output)
//   experiment: tab1/2/3 running `yes` (high output)
//
// Run:
//   DINOTTY_TOKEN=<token> node scripts/repro-f-multi-tab.mjs
// Optional:
//   DINOTTY_URL  default http://127.0.0.1:38999
//   HEADED=1     show browser
//   KEEP_OPEN=1

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:38999'
const TOKEN = process.env.DINOTTY_TOKEN
const HEADED = !!process.env.HEADED
const CHROME = !!process.env.CHROME
const KEEP_OPEN = !!process.env.KEEP_OPEN
const TAB_COUNT = 4

if (!TOKEN) {
  console.error('error: DINOTTY_TOKEN env var is required')
  process.exit(2)
}

const step = (name) => console.log(`\n[step] ${name}`)

async function waitForTerminalApi(page) {
  await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })
}

async function loginAndOpen(browser) {
  const ctx = await browser.newContext()
  const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
  if (!resp.ok()) {
    throw new Error(`login failed: ${resp.status()} ${await resp.text()}`)
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
  return { ctx, page, wsFrames }
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
  // activate via REST so the frontend reflects it
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
    const panes = window.__dinotty_terminal_api.listPanes()
    return panes.some(p => p.id === pid && p.active)
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

// Sample N rAF frames, return intervals in ms.
async function sampleRaf(page, frames = 60) {
  return await page.evaluate(async (n) => {
    const intervals = []
    let last = performance.now()
    for (let i = 0; i < n; i++) {
      await new Promise(r => requestAnimationFrame(r))
      const now = performance.now()
      intervals.push(Math.round((now - last) * 10) / 10)
      last = now
    }
    return intervals
  }, frames)
}

// Send echo marker to a pane, measure ms until it appears in WS frames.
async function measureMarkerLatency(page, wsFrames, paneId, marker) {
  const start = Date.now()
  await sendToPane(page, paneId, `echo ${marker}\n`)
  while (Date.now() - start < 8000) {
    if (wsFrames.some(f => f.payload.includes(marker))) {
      return Date.now() - start
    }
    await page.waitForTimeout(50)
  }
  return -1
}

function summarize(intervals) {
  if (!intervals.length) return null
  const sorted = [...intervals].sort((a, b) => a - b)
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const max = sorted[sorted.length - 1]
  const dropped = intervals.filter(i => i > 50).length
  return { avg: +avg.toFixed(1), p50, p95, max, dropped, n: intervals.length }
}

async function closeAllTabs(ctx, paneIds) {
  try {
    const resp = await ctx.request.get(`${URL}/api/tabs`)
    if (!resp.ok()) return
    const body = await resp.json()
    for (const t of (body.tabs ?? [])) {
      const layoutStr = JSON.stringify(t.layout ?? t)
      if (paneIds.some(pid => layoutStr.includes(pid))) {
        await ctx.request.delete(`${URL}/api/tabs/${t.id ?? t.tab_id}`)
      }
    }
  } catch (e) { /* best effort */ }
}

async function main() {
  console.log(`target: ${URL}`)
  console.log(`headed: ${HEADED}  chrome: ${CHROME}  tabs: ${TAB_COUNT}`)

  const browser = await chromium.launch({ headless: !HEADED, channel: CHROME ? 'chrome' : undefined })
  const A = await loginAndOpen(browser)
  const wsFrames = A.wsFrames
  const paneIds = []

  try {
    step(`create ${TAB_COUNT} fresh tabs`)
    await stabilizePanes(A.page)
    // use any existing tab as tab0, create the rest
    const existing = await A.page.evaluate(() => window.__dinotty_terminal_api.listPanes().map(p => p.id))
    if (existing.length > 0) {
      paneIds.push(existing[0])
    } else {
      paneIds.push(await createTab(A.page, A.ctx))
    }
    for (let i = 1; i < TAB_COUNT; i++) {
      paneIds.push(await createTab(A.page, A.ctx))
    }
    console.log(`  paneIds: ${paneIds.join(', ')}`)

    // activate tab0 as foreground
    await activatePane(A.ctx, A.page, paneIds[0])
    await A.page.setViewportSize({ width: 900, height: 600 })
    await waitForXtermFit(A.page)
    await A.page.waitForTimeout(500)

    // sanity: tab0 marker works
    step('sanity: tab0 probe marker')
    const probe = 'PROBE_' + Date.now()
    const probeLat = await measureMarkerLatency(A.page, wsFrames, paneIds[0], probe)
    console.log(`  probe latency: ${probeLat}ms`)
    if (probeLat < 0) {
      console.log('  FATAL: probe not seen; aborting')
      process.exit(3)
    }

    // ─── baseline: background tabs idle ───
    step('baseline: background tabs idle, measure tab0 rAF + marker latency')
    const baseRaf = await sampleRaf(A.page, 60)
    const baseMarker = 'BASE_' + Date.now()
    const baseLat = await measureMarkerLatency(A.page, wsFrames, paneIds[0], baseMarker)
    console.log(`  rAF: ${JSON.stringify(summarize(baseRaf))}`)
    console.log(`  marker latency: ${baseLat}ms`)

    // ─── experiment: background tabs run yes ───
    step(`experiment: tab1..${TAB_COUNT-1} start yes (background output)`)
    for (let i = 1; i < TAB_COUNT; i++) {
      await sendToPane(A.page, paneIds[i], 'yes\n')
    }
    // let them produce output for a moment
    await A.page.waitForTimeout(1500)
    // re-activate tab0 (creating tabs may have switched active)
    await activatePane(A.ctx, A.page, paneIds[0])
    await A.page.waitForTimeout(500)

    step('measure tab0 rAF + marker latency WHILE background tabs output')
    const expRaf = await sampleRaf(A.page, 60)
    const expMarker = 'EXP_' + Date.now()
    const expLat = await measureMarkerLatency(A.page, wsFrames, paneIds[0], expMarker)
    console.log(`  rAF: ${JSON.stringify(summarize(expRaf))}`)
    console.log(`  marker latency: ${expLat}ms`)

    // ─── stop background yes ───
    step('stop background tabs (Ctrl+C)')
    for (let i = 1; i < TAB_COUNT; i++) {
      await sendToPane(A.page, paneIds[i], '\x03')
    }
    await A.page.waitForTimeout(1500)

    step('post-stop: measure tab0 rAF + marker latency again')
    const postRaf = await sampleRaf(A.page, 60)
    const postMarker = 'POST_' + Date.now()
    const postLat = await measureMarkerLatency(A.page, wsFrames, paneIds[0], postMarker)
    console.log(`  rAF: ${JSON.stringify(summarize(postRaf))}`)
    console.log(`  marker latency: ${postLat}ms`)

    // ─── verdict ───
    step('verdict')
    const baseSum = summarize(baseRaf)
    const expSum = summarize(expRaf)
    const postSum = summarize(postRaf)
    console.log('\n========== VERDICT (F suspect) ==========')
    console.log(`rAF p95:  baseline=${baseSum.p95}ms  experiment=${expSum.p95}ms  post-stop=${postSum.p95}ms`)
    console.log(`rAF max:  baseline=${baseSum.max}ms  experiment=${expSum.max}ms  post-stop=${postSum.max}ms`)
    console.log(`rAF dropped(>50ms): baseline=${baseSum.dropped}  experiment=${expSum.dropped}  post-stop=${postSum.dropped}`)
    console.log(`marker:   baseline=${baseLat}ms  experiment=${expLat}ms  post-stop=${postLat}ms`)
    const rafDegrade = expSum.p95 > baseSum.p95 * 2 && expSum.p95 > 40
    const markerDegrade = expLat > baseLat * 2 && expLat > 500
    if (rafDegrade || markerDegrade) {
      console.log('=> F suspect REPRODUCED: background tabs degrade foreground responsiveness.')
      if (rafDegrade) console.log('   rAF frame interval degraded significantly.')
      if (markerDegrade) console.log('   input round-trip latency degraded significantly.')
    } else {
      console.log('=> F suspect NOT reproduced: background tabs did not degrade foreground.')
    }
    console.log('=========================================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - leaving browser open. Press Ctrl+C to exit.')
      await new Promise(() => {})
    }
  } finally {
    await closeAllTabs(A.ctx, paneIds).catch(() => {})
    await A.ctx.close()
    if (!KEEP_OPEN) await browser.close()
  }
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
