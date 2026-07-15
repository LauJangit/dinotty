#!/usr/bin/env node
// Repro script for E suspect: peer-follow timing window after reload leaves
// terminal locked to stale cols/rows until a manual resize kicks ResizeObserver.
//
// Run:
//   npx playwright@latest install chromium
//   DINOTTY_TOKEN=<your token> node scripts/repro-e-lockstate.mjs
//
// Optional env:
//   DINOTTY_URL   default http://127.0.0.1:28999
//   HEADED=1      show browser windows
//   SLOW=1        add artificial delays between steps
//   KEEP_OPEN=1   don't close browser at end (for manual inspection)

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:28999'
const TOKEN = process.env.DINOTTY_TOKEN
const HEADED = !!process.env.HEADED
const SLOW = !!process.env.SLOW
const KEEP_OPEN = !!process.env.KEEP_OPEN

if (!TOKEN) {
  console.error('error: DINOTTY_TOKEN env var is required')
  process.exit(2)
}

const slow = (ms) => SLOW ? new Promise(r => setTimeout(r, ms)) : null
const step = (name) => console.log(`\n[step] ${name}`)

// Read the *actual* rendered size of the xterm instance attached to the
// *visible* .terminal-pane-container (active tab). We compare the xterm-screen
// pixel size to the wrapper pixel size: when fit is healthy they match closely;
// when the terminal is "locked" to a stale size, xterm-screen stays at the old
// dimensions while the wrapper changes -> mismatch.
//
// We don't rely on char spans because the webgl renderer paints to canvas and
// doesn't emit DOM spans.
async function readMetrics(page, label) {
  return await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const container = containers.find(c => {
      const r = c.getBoundingClientRect()
      return r.width > 10 && r.height > 10
    })
    if (!container) return { error: 'no visible container' }
    const wrapper = container.querySelector('.terminal-pane')
    const screen = container.querySelector('.xterm-screen')
    if (!wrapper || !screen) return { error: 'xterm not ready' }

    const wrapperRect = wrapper.getBoundingClientRect()
    const screenRect = screen.getBoundingClientRect()

    // healthy fit: screen should roughly fill wrapper. xterm-screen = cols*cellW
    // which is <= wrapperW, gap < one cellW (~20px). Use 50px threshold to
    // tolerate scrollbar + padding. A locked/stale terminal will have screen
    // stuck at old dimensions while wrapper changes -> gap >> 50px.
    const THRESH = 50
    const dw = Math.abs(wrapperRect.width  - screenRect.width)
    const dh = Math.abs(wrapperRect.height - screenRect.height)
    const mismatch = dw > THRESH || dh > THRESH

    return {
      wrapper: { w: Math.round(wrapperRect.width), h: Math.round(wrapperRect.height) },
      screen:  { w: Math.round(screenRect.width),  h: Math.round(screenRect.height)  },
      delta:   { dw: Math.round(dw), dh: Math.round(dh) },
      mismatch,
    }
  })
}

function fmtMetrics(m) {
  if (m.error) return `<${m.error}>`
  return JSON.stringify(m)
}

async function waitForTerminalApi(page) {
  await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })
}

async function loginAndOpen(browser) {
  const ctx = await browser.newContext()
  const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
  if (!resp.ok()) {
    const body = await resp.text()
    throw new Error(`login failed: ${resp.status()} ${body}`)
  }
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitForTerminalApi(page)
  return { ctx, page }
}

async function ensureOneTab(ctx, page, label) {
  // Always create a fresh tab for the test, so we don't disturb user's
  // existing panes. Then force-activate it via REST (createTab alone may not
  // switch active tab due to sync WS races between the two clients).
  const before = await page.evaluate(() => window.__dinotty_terminal_api.listPanes().map(p => p.id))
  await page.evaluate(async () => { await window.__dinotty_terminal_api.createTab() })
  const paneId = await page.evaluate(async (beforeArr) => {
    const beforeSet = new Set(beforeArr)
    for (let i = 0; i < 80; i++) {
      const panes = window.__dinotty_terminal_api.listPanes()
      const fresh = panes.find(p => !beforeSet.has(p.id))
      if (fresh) return fresh.id
      await new Promise(r => setTimeout(r, 100))
    }
    return null
  }, before)
  console.log(`  [${label}] new paneId=${paneId}`)

  // find tab_id containing this pane, then activate
  const tabsResp = await ctx.request.get(`${URL}/api/tabs`)
  if (tabsResp.ok()) {
    const body = await tabsResp.json()
    const tabs = body.tabs ?? []
    const tab = tabs.find(t => JSON.stringify(t.layout ?? t).includes(paneId))
    if (tab) {
      const tabId = tab.id ?? tab.tab_id
      await ctx.request.put(`${URL}/api/tabs/${tabId}/pane/${paneId}/activate`)
      console.log(`  [${label}] activated tab ${tabId} / pane ${paneId}`)
    }
  }
  // wait for the active pane to actually switch on the frontend
  await page.waitForFunction((pid) => {
    const api = window.__dinotty_terminal_api
    const panes = api.listPanes()
    return panes.some(p => p.id === pid && p.active)
  }, paneId, { timeout: 5000 }).catch(() => {})
  return paneId
}

async function waitForXterm(page, label) {
  // wait until the visible container's xterm-screen has fit to its wrapper:
  // both dimensions within 50px of each other. This gates on fit completion,
  // not just xterm existing.
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
  await page.waitForTimeout(300)
}

async function closeTabByPaneId(ctx, paneId) {
  try {
    const resp = await ctx.request.get(`${URL}/api/tabs`)
    if (!resp.ok()) return
    const body = await resp.json()
    const tabs = body.tabs ?? []
    for (const t of tabs) {
      const layoutStr = JSON.stringify(t.layout ?? t)
      if (layoutStr.includes(paneId)) {
        await ctx.request.delete(`${URL}/api/tabs/${t.id ?? t.tab_id}`)
        return
      }
    }
  } catch (e) { /* best effort */ }
}

async function sampleTimeline(page, label, checkpoints) {
  const out = []
  const start = Date.now()
  for (const cp of checkpoints) {
    const target = start + cp.at
    const wait = target - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    const m = await readMetrics(page, label)
    out.push({ at: cp.at, label: cp.label, metrics: m })
    console.log(`  [${label}] t+${cp.at}ms (${cp.label}): ${fmtMetrics(m)}`)
  }
  return out
}

async function runScenario(browser, { name, triggerPeerResize }) {
  console.log(`\n========== SCENARIO: ${name} ==========`)
  const A = await loginAndOpen(browser)
  const B = await loginAndOpen(browser)
  await slow(500)
  let testPaneId = null

  try {
    step('A creates a fresh test tab; B mirrors via sync WS')
    testPaneId = await ensureOneTab(A.ctx, A.page, 'A')
    // B should see the new pane via sync WS
    await B.page.waitForFunction((pid) => window.__dinotty_terminal_api.listPanes().some(p => p.id === pid), testPaneId, { timeout: 10000 })
    console.log(`  [B] mirrored test pane: ${testPaneId}`)

    step('set initial viewports 900x600; wait for xterm to fit')
    await A.page.setViewportSize({ width: 900, height: 600 })
    await B.page.setViewportSize({ width: 900, height: 600 })
    await waitForXterm(A.page, 'A')
    await waitForXterm(B.page, 'B')
    await slow(500)

    const aBase = await readMetrics(A.page, 'A')
    console.log('  A baseline:', fmtMetrics(aBase))

    if (triggerPeerResize) {
      step('B shrinks viewport -> A enters peer-follow window')
      await B.page.setViewportSize({ width: 700, height: 500 })
      await B.page.waitForTimeout(300)
      await A.page.waitForTimeout(150)
      const aPeerFollow = await readMetrics(A.page, 'A')
      console.log('  A after peer-resize (should follow B):', fmtMetrics(aPeerFollow))
    }

    step('A reloads')
    await A.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForTerminalApi(A.page)
    await waitForXterm(A.page, 'A-reload')

    step('timeline: sample A metrics at multiple points after reload')
    const timeline = await sampleTimeline(A.page, 'A', [
      { at: 0,    label: 'immediately' },
      { at: 300,  label: 'peer-follow window active' },
      { at: 600,  label: 'peer-follow expired' },
      { at: 1200, label: 'settle window passed' },
      { at: 2500, label: 'idle 2.5s' },
      { at: 5000, label: 'idle 5s' },
    ])

    step('simulate "drag window" at end')
    await A.page.setViewportSize({ width: 1000, height: 700 })
    await A.page.waitForTimeout(600)
    const afterDrag = await readMetrics(A.page, 'A')
    console.log('  A after drag:', fmtMetrics(afterDrag))

    const lastIdle = timeline[timeline.length - 1].metrics
    const locked = lastIdle?.mismatch === true
    const healedByDrag = afterDrag?.mismatch === false
    console.log(`\n  [${name}] locked at 5s idle: ${locked ? 'YES' : 'no'} | healed by drag: ${healedByDrag ? 'yes' : 'NO'}`)

    return { name, locked, healedByDrag, timeline, afterDrag }
  } finally {
    if (testPaneId) {
      await closeTabByPaneId(A.ctx, testPaneId).catch(() => {})
    }
    await A.ctx.close()
    await B.ctx.close()
  }
}

async function main() {
  console.log(`target: ${URL}`)
  console.log(`headed: ${HEADED}  slow: ${SLOW}`)

  const browser = await chromium.launch({ headless: !HEADED })

  try {
    const results = []
    results.push(await runScenario(browser, { name: 'control (no B resize)', triggerPeerResize: false }))
    results.push(await runScenario(browser, { name: 'experiment (B resize -> A reload)', triggerPeerResize: true }))

    step('final verdict')
    console.log('\n========== VERDICT ==========')
    for (const r of results) {
      console.log(`${r.name}: locked=${r.locked} healedByDrag=${r.healedByDrag}`)
    }
    const exp = results[1]
    const ctrl = results[0]
    if (exp.locked && !ctrl.locked && exp.healedByDrag) {
      console.log('=> E suspect REPRODUCED: peer-resize + reload locks terminal; drag restores.')
    } else if (exp.locked && ctrl.locked) {
      console.log('=> both scenarios lock - not specific to peer-follow; check C suspect (snapshot race).')
    } else if (!exp.locked && !ctrl.locked) {
      console.log('=> E suspect NOT reproduced on this run. Try SLOW=1 or iterate.')
    } else {
      console.log('=> ambiguous - inspect timelines above.')
    }
    console.log('=============================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - leaving browser open. Press Ctrl+C to exit.')
      await new Promise(() => {})
    }
  } finally {
    if (!KEEP_OPEN) await browser.close()
  }
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
