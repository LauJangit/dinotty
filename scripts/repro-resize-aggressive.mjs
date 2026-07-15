#!/usr/bin/env node
// Aggressive repro: 4 tabs + high output + A refresh + B wheel scroll.
//
// Simulates the user's actual conditions:
//   - 4 tabs (3 background running `yes`, 1 foreground shared by A+B)
//   - High output on the foreground pane (simulating Claude)
//   - A refreshes while output flows
//   - B does fast wheel up/down (as the user described)
//   - Check if B's write pump dies (marker echo fails = "can't input")
//
// Run:
//   DINOTTY_TOKEN=<token> node scripts/repro-resize-aggressive.mjs
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
const TAB_COUNT = 4

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

async function getCenter(page) {
  return await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const v = cs.find(c => c.getBoundingClientRect().width > 10)
    const r = v.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
}

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
    if (!wrapper || !screen) return { error: 'xterm not ready' }
    const wrapperRect = wrapper.getBoundingClientRect()
    const screenRect = screen.getBoundingClientRect()
    return {
      wrapper: { w: Math.round(wrapperRect.width), h: Math.round(wrapperRect.height) },
      screen: { w: Math.round(screenRect.width), h: Math.round(screenRect.height) },
      scrollTop: Math.round(viewport?.scrollTop ?? 0),
      scrollHeight: Math.round(viewport?.scrollHeight ?? 0),
    }
  })
}

function scanWs(wsFrames, needle) {
  return wsFrames.some(f => f.payload.includes(needle))
}

async function measureMarkerRoundTrip(page, wsFrames, paneId, marker, timeoutMs = 5000) {
  const start = Date.now()
  await sendToPane(page, paneId, `echo ${marker}\n`)
  while (Date.now() - start < timeoutMs) {
    if (scanWs(wsFrames, marker)) {
      return Date.now() - start
    }
    await page.waitForTimeout(50)
  }
  return -1
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
  } catch {}
}

async function main() {
  console.log(`target: ${URL}`)
  console.log(`headed: ${HEADED}  chrome: ${CHROME}  tabs: ${TAB_COUNT}`)

  const browser = await chromium.launch({ headless: !HEADED, channel: CHROME ? 'chrome' : undefined })
  const A = await loginAndOpen(browser, 'A')
  const B = await loginAndOpen(browser, 'B')
  const paneIds = []

  try {
    step(`create ${TAB_COUNT} tabs`)
    await stabilizePanes(A.page)
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

    // B mirrors all panes
    for (const pid of paneIds) {
      await B.page.waitForFunction((id) => {
        return window.__dinotty_terminal_api.listPanes().some(p => p.id === id)
      }, pid, { timeout: 10000 })
    }
    console.log('  B mirrored all panes')

    step('set different viewport sizes: A small, B large')
    await A.page.setViewportSize({ width: 700, height: 450 })
    await B.page.setViewportSize({ width: 1400, height: 900 })
    await activatePane(A.ctx, A.page, paneIds[0])
    await activatePane(A.ctx, B.page, paneIds[0])
    await waitForXtermFit(A.page)
    await waitForXtermFit(B.page)
    await A.page.waitForTimeout(500)

    step('start yes on ALL background tabs (1,2,3) + foreground tab (0)')
    for (const pid of paneIds) {
      await sendToPane(A.page, pid, 'yes\n')
    }
    await A.page.waitForTimeout(2000)
    const aFramesMid = A.wsFrames.length
    const bFramesMid = B.wsFrames.length
    await A.page.waitForTimeout(1000)
    console.log(`  A output frames/s: ${A.wsFrames.length - aFramesMid}`)
    console.log(`  B output frames/s: ${B.wsFrames.length - bFramesMid}`)

    step('baseline: B can echo a marker (under high output from 4 tabs)')
    const baseMarker = 'BASE_' + Date.now()
    const baseLat = await measureMarkerRoundTrip(B.page, B.wsFrames, paneIds[0], baseMarker, 8000)
    console.log(`  B baseline marker latency: ${baseLat}ms ${baseLat > 0 ? 'OK' : 'FAILED'}`)

    step('B does fast wheel up/down for 3s (simulating user scroll)')
    const center = await getCenter(B.page)
    await B.page.mouse.move(center.x, center.y)
    const wheelStart = Date.now()
    let wheelCount = 0
    while (Date.now() - wheelStart < 3000) {
      await B.page.mouse.wheel(0, 800)   // wheel down
      wheelCount++
      await B.page.waitForTimeout(15)
      if (wheelCount % 3 === 0) {
        await B.page.mouse.wheel(0, -1200) // wheel up
      }
    }
    console.log(`  B dispatched ${wheelCount} wheel events`)

    step('A refreshes WHILE B is scrolling + 4 tabs outputting')
    // First stop foreground yes on pane 0 so the refresh doesn't drown in output
    await sendToPane(A.page, paneIds[0], '\x03')
    await A.page.waitForTimeout(200)
    await A.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForTerminalApi(A.page)
    await waitForXtermFit(A.page)
    await A.page.waitForTimeout(1500)

    // Restart yes on pane 0 (A reconnected, shell prompt should be back)
    await sendToPane(A.page, paneIds[0], 'yes\n')
    await A.page.waitForTimeout(1000)

    const aState1 = await readTerminalState(A.page)
    const bState1 = await readTerminalState(B.page)
    console.log(`  A after reconnect: screen=${aState1.screen?.w}x${aState1.screen?.h}`)
    console.log(`  B after A refresh: screen=${bState1.screen?.w}x${bState1.screen?.h} scrollTop=${bState1.scrollTop}`)

    step('B does MORE fast wheel up/down for 3s (post-refresh scroll)')
    await B.page.mouse.move(center.x, center.y)
    const wheelStart2 = Date.now()
    let wheelCount2 = 0
    while (Date.now() - wheelStart2 < 3000) {
      await B.page.mouse.wheel(0, 800)
      wheelCount2++
      await B.page.waitForTimeout(15)
      if (wheelCount2 % 3 === 0) {
        await B.page.mouse.wheel(0, -1200)
      }
    }
    console.log(`  B dispatched ${wheelCount2} more wheel events`)

    step('post-refresh: can B echo a marker? (write pump health)')
    const postMarker = 'POST_' + Date.now()
    const postLat = await measureMarkerRoundTrip(B.page, B.wsFrames, paneIds[0], postMarker, 10000)
    console.log(`  B post-refresh marker latency: ${postLat}ms ${postLat > 0 ? 'OK' : 'FAILED'}`)

    step('check if B is still receiving output at all')
    const bFramesBefore = B.wsFrames.length
    await B.page.waitForTimeout(2000)
    const bFramesAfter = B.wsFrames.length
    const newFrames = bFramesAfter - bFramesBefore
    console.log(`  B received ${newFrames} WS frames in 2s ${newFrames > 5 ? '(output flowing)' : '(NO OUTPUT - write pump may be dead)'}`)

    const bState2 = await readTerminalState(B.page)
    console.log(`  B final: screen=${bState2.screen?.w}x${bState2.screen?.h} scrollTop=${bState2.scrollTop} scrollHeight=${bState2.scrollHeight}`)

    // Stop all yes
    for (const pid of paneIds) {
      await sendToPane(A.page, pid, '\x03').catch(() => {})
      await sendToPane(B.page, pid, '\x03').catch(() => {})
    }
    await A.page.waitForTimeout(500)

    step('final marker test after stopping output')
    const finalMarker = 'FINAL_' + Date.now()
    const finalLat = await measureMarkerRoundTrip(B.page, B.wsFrames, paneIds[0], finalMarker, 8000)
    console.log(`  B final marker latency (output stopped): ${finalLat}ms ${finalLat > 0 ? 'OK' : 'FAILED'}`)

    step('verdict')
    console.log('\n========== VERDICT (aggressive) ==========')
    const sameScreen = bState1.screen?.w === aState1.screen?.w && bState1.screen?.h === aState1.screen?.h
    console.log(`A screen:  ${aState1.screen?.w}x${aState1.screen?.h}`)
    console.log(`B screen:  ${bState1.screen?.w}x${bState1.screen?.h}`)
    console.log(`B aligned with PTY: ${sameScreen ? 'yes' : 'NO (misaligned)'}`)
    console.log(`B baseline echo: ${baseLat > 0 ? baseLat + 'ms' : 'FAILED'}`)
    console.log(`B post-refresh echo: ${postLat > 0 ? postLat + 'ms' : 'FAILED'}`)
    console.log(`B final echo (output stopped): ${finalLat > 0 ? finalLat + 'ms' : 'FAILED'}`)
    console.log(`B still receiving output: ${newFrames > 5 ? 'yes' : 'NO'}`)

    if (postLat < 0 && newFrames <= 5) {
      console.log('=> REPRODUCED: B write pump dead after A refresh + scroll (P1)')
    } else if (postLat < 0 && newFrames > 5) {
      console.log('=> PARTIAL: B receiving output but marker not echoed (echo path broken)')
    } else if (postLat > 2000) {
      console.log(`=> PARTIAL: B echo severely degraded (${postLat}ms vs ${baseLat}ms baseline)`)
    } else if (!sameScreen) {
      console.log('=> B misaligned but input works (resize issue only, no P1)')
    } else if (sameScreen && postLat > 0 && postLat < 500) {
      console.log('=> NOT reproduced')
    } else {
      console.log('=> ambiguous - inspect metrics above')
    }
    console.log('===========================================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - leaving browser open. Press Ctrl+C to exit.')
      await new Promise(() => {})
    }
  } finally {
    // stop all yes best-effort
    for (const pid of paneIds) {
      await sendToPane(A.page, pid, '\x03').catch(() => {})
    }
    await closeAllTabs(A.ctx, paneIds).catch(() => {})
    await A.ctx.close()
    await B.ctx.close()
    if (!KEEP_OPEN) await browser.close()
  }
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
