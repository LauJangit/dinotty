#!/usr/bin/env node
// Repro script for A suspect: high PTY output + fast wheel scroll ->
// write-queue x scrollToBottom x synthetic-WheelEvent race ->
// xterm renderer stuck, textarea loses focus, IME composes but text
// never reaches PTY.
//
// Single client (user says single-end freeze is a frontend problem).
//
// Run:
//   DINOTTY_TOKEN=<token> node scripts/repro-a-wheel-freeze.mjs
//
// Optional env:
//   DINOTTY_URL   default http://127.0.0.1:28999
//   HEADED=1      show browser window
//   KEEP_OPEN=1   don't close at end

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:28999'
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

async function loginAndOpen(browser) {
  const ctx = await browser.newContext()
  const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
  if (!resp.ok()) {
    const body = await resp.text()
    throw new Error(`login failed: ${resp.status()} ${body}`)
  }
  const page = await ctx.newPage()
  // collect all WS frames so we can inspect PTY output directly,
  // bypassing the flaky __dinotty_terminal_api.onOutput hook.
  const wsFrames = [] // {url, payload}
  page.on('websocket', ws => {
    ws.on('framereceived', frame => {
      const payload = frame.payload
      if (typeof payload === 'string') {
        wsFrames.push({ url: ws.url(), payload })
      }
    })
  })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitForTerminalApi(page)
  return { ctx, page, wsFrames }
}

async function ensureOneTab(ctx, page, label) {
  // wait for listPanes to stabilize (sync WS may still be mirroring tabs)
  let lastCount = -1
  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate(() => window.__dinotty_terminal_api.listPanes().length)
    if (count === lastCount) break
    lastCount = count
    await page.waitForTimeout(200)
  }
  const before = await page.evaluate(() => window.__dinotty_terminal_api.listPanes().map(p => p.id))
  console.log(`  [${label}] stable pane count: ${before.length}`)
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
  console.log(`  [${label}] new paneId=${paneId} (was in before? ${before.includes(paneId)})`)
  if (!paneId || before.includes(paneId)) {
    console.log(`  [${label}] FATAL: did not create a fresh pane; not sending to avoid disturbing user`)
    return null
  }
  const tabsResp = await ctx.request.get(`${URL}/api/tabs`)
  if (tabsResp.ok()) {
    const body = await tabsResp.json()
    const tabs = body.tabs ?? []
    const tab = tabs.find(t => JSON.stringify(t.layout ?? t).includes(paneId))
    if (tab) {
      const tabId = tab.id ?? tab.tab_id
      await ctx.request.put(`${URL}/api/tabs/${tabId}/pane/${paneId}/activate`)
    }
  }
  await page.waitForFunction((pid) => {
    const panes = window.__dinotty_terminal_api.listPanes()
    return panes.some(p => p.id === pid && p.active)
  }, paneId, { timeout: 5000 }).catch(() => {})
  return paneId
}

async function waitForXterm(page) {
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
      if (JSON.stringify(t.layout ?? t).includes(paneId)) {
        await ctx.request.delete(`${URL}/api/tabs/${t.id ?? t.tab_id}`)
        return
      }
    }
  } catch (e) { /* best effort */ }
}

// Scan accumulated WS frames for a substring. Output frames are JSON like
// {"type":"output","data":"..."} so a plain substring search on the raw
// frame payload works for any marker string.
function scanWs(wsFrames, needle) {
  return wsFrames.some(f => f.payload.includes(needle))
}

function wsOutputStats(wsFrames) {
  let outputFrames = 0
  let outputChars = 0
  for (const f of wsFrames) {
    try {
      const j = JSON.parse(f.payload)
      if (j.type === 'output' && typeof j.data === 'string') {
        outputFrames++
        outputChars += j.data.length
      }
    } catch {}
  }
  return { outputFrames, outputChars }
}

async function getFocusState(page) {
  return await page.evaluate(() => {
    const textarea = document.querySelector('.terminal-pane-container .xterm-helper-textarea')
      ?? document.querySelector('.xterm-helper-textarea')
    return {
      activeTag: document.activeElement?.tagName,
      activeClass: document.activeElement?.className,
      textareaExists: !!textarea,
      textareaIsFocused: textarea === document.activeElement,
      textareaHasFocus: textarea?.matches(':focus') ?? false,
    }
  })
}

async function main() {
  console.log(`target: ${URL}`)
  console.log(`headed: ${HEADED}  chrome: ${CHROME}`)

  const browser = await chromium.launch({ headless: !HEADED, channel: CHROME ? 'chrome' : undefined })
  const A = await loginAndOpen(browser)
  const wsFrames = A.wsFrames
  let testPaneId = null

  try {
    step('create fresh test tab + activate')
    testPaneId = await ensureOneTab(A.ctx, A.page, 'A')
    if (!testPaneId) {
      console.log('FATAL: could not create fresh test tab; aborting to avoid disturbing user panes')
      process.exit(3)
    }
    await A.page.setViewportSize({ width: 900, height: 600 })
    await waitForXterm(A.page)
    // give the pane WS time to connect
    await A.page.waitForTimeout(500)

    step('sanity: send probe marker, confirm we see it in WS frames')
    const probeMarker = 'PROBE_' + Date.now()
    await A.page.evaluate(({pid, m}) => {
      window.__dinotty_terminal_api.send(pid, `echo ${m}\n`)
    }, {pid: testPaneId, m: probeMarker})
    let probeSeen = false
    const probeStart = Date.now()
    while (Date.now() - probeStart < 4000) {
      if (scanWs(wsFrames, probeMarker)) { probeSeen = true; break }
      await A.page.waitForTimeout(100)
    }
    console.log(`  probe seen: ${probeSeen}`)
    if (!probeSeen) {
      console.log('  FATAL: probe not seen in WS frames - send or WS path broken; aborting')
      console.log(`  ws frame count: ${wsFrames.length}, output stats: ${JSON.stringify(wsOutputStats(wsFrames))}`)
      process.exit(3)
    }

    step('focus the terminal textarea')
    await A.page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.terminal-pane-container'))
      const visible = containers.find(c => c.getBoundingClientRect().width > 10)
      visible?.querySelector('.xterm-helper-textarea')?.focus()
    })
    await A.page.waitForTimeout(200)
    const focusBefore = await getFocusState(A.page)
    console.log('  focus before wheel:', JSON.stringify(focusBefore))

    step('start high-output command: yes')
    const yesStartFrames = wsFrames.length
    await A.page.evaluate((pid) => {
      window.__dinotty_terminal_api.send(pid, 'yes\n')
    }, testPaneId)
    await A.page.waitForTimeout(2000)
    const yesStats = wsOutputStats(wsFrames.slice(yesStartFrames))
    console.log(`  output during yes: ${yesStats.outputFrames} frames, ${yesStats.outputChars} chars`)

    step('move mouse to xterm center + fast wheel scroll for 3s')
    const center = await A.page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.terminal-pane-container'))
      const visible = containers.find(c => c.getBoundingClientRect().width > 10)
      const r = visible.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    await A.page.mouse.move(center.x, center.y)
    const wheelStart = Date.now()
    let wheelCount = 0
    while (Date.now() - wheelStart < 3000) {
      await A.page.mouse.wheel(0, 800)
      wheelCount++
      await A.page.waitForTimeout(20)
      if (wheelCount % 20 === 0) {
        await A.page.mouse.wheel(0, -800)
      }
    }
    console.log(`  wheel events dispatched: ${wheelCount}`)

    step('stop yes with Ctrl+C')
    await A.page.evaluate((pid) => {
      window.__dinotty_terminal_api.send(pid, '\x03')
    }, testPaneId)
    await A.page.waitForTimeout(800)

    const focusAfterWheel = await getFocusState(A.page)
    console.log('  focus after wheel:', JSON.stringify(focusAfterWheel))

    step('send echo marker, check if it is echoed back (input path working?)')
    const marker = 'DINOTTY_MARKER_' + Date.now()
    const markerSendFrames = wsFrames.length
    await A.page.evaluate(({pid, m}) => {
      window.__dinotty_terminal_api.send(pid, `echo ${m}\n`)
    }, {pid: testPaneId, m: marker})

    let markerSeen = false
    let markerAt = -1
    const markerStart = Date.now()
    while (Date.now() - markerStart < 5000) {
      if (scanWs(wsFrames, marker)) {
        markerSeen = true
        markerAt = Date.now() - markerStart
        break
      }
      await A.page.waitForTimeout(100)
    }
    const markerStats = wsOutputStats(wsFrames.slice(markerSendFrames))
    console.log(`  marker seen: ${markerSeen} at ${markerAt}ms`)
    console.log(`  output after marker send: ${markerStats.outputFrames} frames, ${markerStats.outputChars} chars`)

    step('verdict')
    console.log('\n========== VERDICT (A suspect) ==========')
    const focusLostBefore = focusBefore.textareaIsFocused && !focusAfterWheel.textareaIsFocused
    const inputBlocked = !markerSeen
    console.log(`textarea focus lost during wheel: ${focusLostBefore ? 'YES' : 'no'}`)
    console.log(`  (before: ${focusBefore.textareaIsFocused}, after: ${focusAfterWheel.textareaIsFocused})`)
    console.log(`input path blocked (marker not echoed): ${inputBlocked ? 'YES' : 'no'}`)
    console.log(`yes produced output: ${yesStats.outputChars > 0 ? 'yes' : 'NO'} (${yesStats.outputChars} chars)`)
    if (yesStats.outputChars > 0 && inputBlocked) {
      console.log('=> A suspect REPRODUCED: high output + wheel blocks input path.')
    } else if (yesStats.outputChars > 0 && !inputBlocked) {
      console.log('=> A suspect NOT reproduced: input path still works after wheel.')
    } else if (yesStats.outputChars === 0) {
      console.log('=> inconclusive: yes did not produce output (PTY or WS issue)')
    } else {
      console.log('=> ambiguous - inspect metrics above.')
    }
    console.log('==========================================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - leaving browser open. Press Ctrl+C to exit.')
      await new Promise(() => {})
    }
  } finally {
    if (testPaneId) await closeTabByPaneId(A.ctx, testPaneId).catch(() => {})
    await A.ctx.close()
    if (!KEEP_OPEN) await browser.close()
  }
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
