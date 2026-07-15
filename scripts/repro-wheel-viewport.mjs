#!/usr/bin/env node
// Repro script for wheel-viewport freeze: during high PTY output, the
// _writePinnedToBottom state machine + scrollToBottom in _processWriteQueue
// may pin the viewport to the bottom, so user's upward wheel scroll can't
// actually move the viewport - "scroll stuck" as the user describes.
//
// Measure: during `yes` output, send one upward wheel event, sample
// viewport.scrollTop at 0/10/50/100/200/500ms. If scrollTop never decreases
// (i.e. never goes up), the viewport is stuck.
//
// Run:
//   CHROME=1 HEADED=1 DINOTTY_TOKEN=<token> node scripts/repro-wheel-viewport.mjs

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:38999'
const TOKEN = process.env.DINOTTY_TOKEN
const HEADED = !!process.env.HEADED
const CHROME = !!process.env.CHROME
const KEEP_OPEN = !!process.env.KEEP_OPEN

if (!TOKEN) { console.error('DINOTTY_TOKEN required'); process.exit(2) }

const step = (n) => console.log(`\n[step] ${n}`)

async function waitForTerminalApi(page) {
  await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })
}

async function loginAndOpen(browser) {
  const ctx = await browser.newContext()
  const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
  if (!resp.ok()) throw new Error(`login failed: ${resp.status()}`)
  const page = await ctx.newPage()
  const wsFrames = []
  page.on('websocket', ws => {
    ws.on('framereceived', f => { if (typeof f.payload === 'string') wsFrames.push(f.payload) })
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
    const s = new Set(beforeArr)
    for (let i = 0; i < 80; i++) {
      const panes = window.__dinotty_terminal_api.listPanes()
      if (panes.length > beforeArr.length) {
        const f = panes.find(p => !s.has(p.id))
        if (f) return f.id
      }
      await new Promise(r => setTimeout(r, 100))
    }
    return null
  }, before)
  const r = await ctx.request.get(`${URL}/api/tabs`)
  if (r.ok()) {
    const body = await r.json()
    const tab = (body.tabs ?? []).find(t => JSON.stringify(t.layout ?? t).includes(paneId))
    if (tab) await ctx.request.put(`${URL}/api/tabs/${tab.id ?? tab.tab_id}/pane/${paneId}/activate`)
  }
  return paneId
}

async function activatePane(ctx, page, paneId) {
  const r = await ctx.request.get(`${URL}/api/tabs`)
  if (!r.ok()) return
  const body = await r.json()
  const tab = (body.tabs ?? []).find(t => JSON.stringify(t.layout ?? t).includes(paneId))
  if (!tab) return
  await ctx.request.put(`${URL}/api/tabs/${tab.id ?? tab.tab_id}/pane/${paneId}/activate`)
  await page.waitForFunction((pid) => {
    return window.__dinotty_terminal_api.listPanes().some(p => p.id === pid && p.active)
  }, paneId, { timeout: 5000 }).catch(() => {})
}

async function sendToPane(page, paneId, data) {
  await page.evaluate(({pid, d}) => window.__dinotty_terminal_api.send(pid, d), {pid: paneId, d: data})
}

async function waitForXtermFit(page) {
  await page.waitForFunction(() => {
    const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const v = cs.find(c => { const r = c.getBoundingClientRect(); return r.width > 10 && r.height > 10 })
    if (!v) return false
    const w = v.querySelector('.terminal-pane'), s = v.querySelector('.xterm-screen')
    if (!w || !s) return false
    const wr = w.getBoundingClientRect(), sr = s.getBoundingClientRect()
    if (sr.width < 10 || sr.height < 10) return false
    return Math.abs(wr.width - sr.width) < 50 && Math.abs(wr.height - sr.height) < 50
  }, { timeout: 15000 })
}

async function getViewportScroll(page) {
  return await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const v = cs.find(c => c.getBoundingClientRect().width > 10)
    const vp = v?.querySelector('.xterm-viewport')
    if (!vp) return null
    return { scrollTop: vp.scrollTop, scrollHeight: vp.scrollHeight, clientHeight: vp.clientHeight }
  })
}

async function getCenter(page) {
  return await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const v = cs.find(c => c.getBoundingClientRect().width > 10)
    const r = v.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
}

// Send one upward wheel and sample scrollTop at several points.
// Returns { before, samples: [{t, scrollTop}] }
async function wheelUpAndSample(page, center) {
  const before = await getViewportScroll(page)
  // move mouse to center
  await page.mouse.move(center.x, center.y)
  // upward wheel: negative deltaY
  await page.mouse.wheel(0, -3000)
  const samples = []
  const start = Date.now()
  const checkpoints = [0, 10, 30, 60, 100, 200, 350, 500, 750, 1000]
  for (const cp of checkpoints) {
    const target = start + cp
    const wait = target - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    const s = await getViewportScroll(page)
    samples.push({ t: cp, scrollTop: s?.scrollTop ?? null })
  }
  return { before: before?.scrollTop ?? null, samples }
}

async function closeTabByPaneId(ctx, paneId) {
  try {
    const r = await ctx.request.get(`${URL}/api/tabs`)
    if (!r.ok()) return
    const body = await r.json()
    for (const t of (body.tabs ?? [])) {
      if (JSON.stringify(t.layout ?? t).includes(paneId)) {
        await ctx.request.delete(`${URL}/api/tabs/${t.id ?? t.tab_id}`)
        return
      }
    }
  } catch {}
}

async function main() {
  console.log(`target: ${URL}\nheaded: ${HEADED}  chrome: ${CHROME}`)
  const browser = await chromium.launch({ headless: !HEADED, channel: CHROME ? 'chrome' : undefined })
  const A = await loginAndOpen(browser)
  const wsFrames = A.wsFrames
  let paneId = null

  try {
    step('create fresh tab + activate')
    await stabilizePanes(A.page)
    paneId = await createTab(A.page, A.ctx)
    if (!paneId) { console.log('FATAL: no pane'); process.exit(3) }
    await A.page.setViewportSize({ width: 900, height: 600 })
    await waitForXtermFit(A.page)
    await A.page.waitForTimeout(400)

    // sanity probe
    const probe = 'PROBE_' + Date.now()
    await sendToPane(A.page, paneId, `echo ${probe}\n`)
    let probeOk = false
    const ps = Date.now()
    while (Date.now() - ps < 4000) {
      if (wsFrames.some(f => f.includes(probe))) { probeOk = true; break }
      await A.page.waitForTimeout(50)
    }
    console.log(`  probe: ${probeOk ? 'ok' : 'FAILED'}`)
    if (!probeOk) process.exit(3)

    const center = await getCenter(A.page)

    // ─── baseline: no output, wheel up ───
    step('baseline: idle terminal, wheel up - does viewport move up?')
    const baseSample = await wheelUpAndSample(A.page, center)
    console.log(`  before scrollTop: ${baseSample.before}`)
    for (const s of baseSample.samples) console.log(`    t+${s.t}ms: scrollTop=${s.scrollTop}`)
    const baseMin = Math.min(...baseSample.samples.map(s => s.scrollTop ?? Infinity))
    const baseMoved = baseSample.before != null && baseMin < baseSample.before
    console.log(`  viewport moved up: ${baseMoved ? 'yes' : 'no'} (min=${baseMin}, before=${baseSample.before})`)

    // ─── experiment: yes running, wheel up ───
    step('experiment: yes running, wheel up - does viewport move up?')
    await sendToPane(A.page, paneId, 'yes\n')
    await A.page.waitForTimeout(1500) // let output fill the buffer
    const expSample = await wheelUpAndSample(A.page, center)
    console.log(`  before scrollTop: ${expSample.before}`)
    for (const s of expSample.samples) console.log(`    t+${s.t}ms: scrollTop=${s.scrollTop}`)
    const expMin = Math.min(...expSample.samples.map(s => s.scrollTop ?? Infinity))
    const expMoved = expSample.before != null && expMin < expSample.before
    console.log(`  viewport moved up: ${expMoved ? 'yes' : 'no'} (min=${expMin}, before=${expSample.before})`)

    // ─── also try multiple rapid upward wheels ───
    step('experiment 2: yes running, 5 rapid upward wheels')
    const before2 = await getViewportScroll(A.page)
    await page_mouse_wheel_multi(A.page, center, -4000, 5, 30)
    await A.page.waitForTimeout(500)
    const after2 = await getViewportScroll(A.page)
    console.log(`  before: ${before2?.scrollTop}  after 5 wheels + 500ms: ${after2?.scrollTop}`)
    console.log(`  viewport moved up: ${(before2?.scrollTop ?? 0) > (after2?.scrollTop ?? 0) ? 'yes' : 'no'}`)

    // stop yes
    await sendToPane(A.page, paneId, '\x03')
    await A.page.waitForTimeout(800)

    step('verdict')
    console.log('\n========== VERDICT (wheel viewport freeze) ==========')
    console.log(`idle:    viewport responds to wheel = ${baseMoved ? 'yes' : 'NO'}`)
    console.log(`yes run: viewport responds to wheel = ${expMoved ? 'yes' : 'NO'}`)
    if (baseMoved && !expMoved) {
      console.log('=> REPRODUCED: high output pins viewport to bottom, wheel cannot scroll up.')
    } else if (!baseMoved && !expMoved) {
      console.log('=> viewport never responds to wheel - test setup issue (Playwright wheel may not reach xterm).')
    } else {
      console.log('=> NOT reproduced: viewport still responds to wheel during high output.')
    }
    console.log('======================================================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - press Ctrl+C to exit')
      await new Promise(() => {})
    }
  } finally {
    if (paneId) await closeTabByPaneId(A.ctx, paneId).catch(() => {})
    await A.ctx.close()
    if (!KEEP_OPEN) await browser.close()
  }
}

async function page_mouse_wheel_multi(page, center, deltaY, times, gapMs) {
  await page.mouse.move(center.x, center.y)
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, deltaY)
    await page.waitForTimeout(gapMs)
  }
}

main().catch(err => { console.error('fatal:', err); process.exit(1) })
