#!/usr/bin/env node
// Aggressive repro v2: 4 tabs + high output + A refresh + B wheel scroll.
//
// Key fix vs v1: stop `yes` before marker tests (yes blocks echo).
// Detect write pump death by sampling B's scrollHeight: if it stops growing
// while WS frames keep arriving, the pump is dead.
//
// Run:
//   DINOTTY_TOKEN=<token> node scripts/repro-resize-aggressive2.mjs
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
    // Try to read xterm buffer content (last 5 lines) via internal API
    let bufferTail = null
    try {
      // xterm.js 5: access via the terminal instance stored on the element
      // The TerminalInstance from useTerminal stores xterm on `this.xterm`
      // but that's not on the DOM. Try the _core path.
      const xtermEl = container.querySelector('.xterm')
      // Some builds expose _terminal on the element
      const term = xtermEl?._terminal
      if (term?.buffer?.active) {
        const buf = term.buffer.active
        const lines = []
        const baseY = buf.baseY
        const rows = term.rows
        for (let i = rows - 1; i >= 0 && i >= rows - 5; i--) {
          const line = buf.getLine(baseY + i)
          if (line) lines.push(line.translateToString(true))
        }
        bufferTail = lines
      }
    } catch (e) {
      bufferTail = { error: String(e) }
    }
    return {
      wrapper: { w: Math.round(wrapperRect.width), h: Math.round(wrapperRect.height) },
      screen: { w: Math.round(screenRect.width), h: Math.round(screenRect.height) },
      scrollTop: Math.round(viewport?.scrollTop ?? 0),
      scrollHeight: Math.round(viewport?.scrollHeight ?? 0),
      bufferTail,
    }
  })
}

function scanWs(wsFrames, needle) {
  return wsFrames.some(f => f.payload.includes(needle))
}

// Stop yes, wait for prompt, send echo marker, check WS + buffer.
async function testEcho(page, wsFrames, paneId, label) {
  // Stop yes
  await sendToPane(page, paneId, '\x03')
  await page.waitForTimeout(800) // wait for shell prompt
  const marker = label + '_' + Date.now()
  const wsBefore = wsFrames.length
  await sendToPane(page, paneId, `echo ${marker}\n`)
  // Wait for marker in WS (shell echoed it)
  let wsLatency = -1
  const start = Date.now()
  while (Date.now() - start < 5000) {
    if (scanWs(wsFrames.slice(wsBefore), marker)) {
      wsLatency = Date.now() - start
      break
    }
    await page.waitForTimeout(50)
  }
  // Wait a bit for xterm to render
  await page.waitForTimeout(500)
  // Check if marker is in xterm buffer
  const state = await readTerminalState(page)
  let inBuffer = false
  if (Array.isArray(state.bufferTail)) {
    inBuffer = state.bufferTail.some(line => line.includes(marker))
  }
  return { marker, wsLatency, inBuffer, bufferTail: state.bufferTail }
}

// Sample scrollHeight over 2s to detect if write pump is still processing.
async function samplePumpHealth(page, wsFrames) {
  const samples = []
  const wsBefore = wsFrames.length
  const start = Date.now()
  for (const t of [0, 500, 1000, 2000]) {
    const target = start + t
    const wait = target - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    const s = await readTerminalState(page)
    samples.push({ t, scrollHeight: s.scrollHeight, wsFrames: wsFrames.length - wsBefore })
  }
  const heightGrowth = samples[samples.length - 1].scrollHeight - samples[0].scrollHeight
  const wsGrowth = samples[samples.length - 1].wsFrames - samples[0].wsFrames
  return { samples, heightGrowth, wsGrowth, pumpAlive: heightGrowth > 0 || wsGrowth === 0 }
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

    for (const pid of paneIds) {
      await B.page.waitForFunction((id) => {
        return window.__dinotty_terminal_api.listPanes().some(p => p.id === id)
      }, pid, { timeout: 10000 })
    }

    step('set different viewport sizes: A small, B large')
    await A.page.setViewportSize({ width: 700, height: 450 })
    await B.page.setViewportSize({ width: 1400, height: 900 })
    await activatePane(A.ctx, A.page, paneIds[0])
    await activatePane(A.ctx, B.page, paneIds[0])
    await waitForXtermFit(A.page)
    await waitForXtermFit(B.page)
    await A.page.waitForTimeout(500)

    step('baseline echo test (idle, no output)')
    const baseResult = await testEcho(B.page, B.wsFrames, paneIds[0], 'BASE')
    console.log(`  wsLatency: ${baseResult.wsLatency}ms  inBuffer: ${baseResult.inBuffer}`)
    console.log(`  bufferTail: ${JSON.stringify(baseResult.bufferTail?.slice?.(-2) ?? baseResult.bufferTail)}`)

    step('start yes on ALL 4 tabs')
    for (const pid of paneIds) {
      await sendToPane(A.page, pid, 'yes\n')
    }
    await A.page.waitForTimeout(2000)

    step('B does fast wheel up/down for 3s (simulating user scroll during high output)')
    const center = await getCenter(B.page)
    await B.page.mouse.move(center.x, center.y)
    const wheelStart = Date.now()
    let wheelCount = 0
    while (Date.now() - wheelStart < 3000) {
      await B.page.mouse.wheel(0, 800)
      wheelCount++
      await B.page.waitForTimeout(15)
      if (wheelCount % 3 === 0) {
        await B.page.mouse.wheel(0, -1200)
      }
    }
    console.log(`  B dispatched ${wheelCount} wheel events`)

    step('sample B write pump health DURING high output + after scroll')
    const pumpHealth = await samplePumpHealth(B.page, B.wsFrames)
    console.log(`  scrollHeight growth: ${pumpHealth.heightGrowth}px over 2s`)
    console.log(`  WS frames received: ${pumpHealth.wsGrowth} over 2s`)
    console.log(`  pump alive: ${pumpHealth.pumpAlive ? 'yes' : 'NO (write pump dead!)'}`)
    for (const s of pumpHealth.samples) {
      console.log(`    t+${s.t}ms: scrollHeight=${s.scrollHeight} wsFrames=${s.wsFrames}`)
    }

    step('A refreshes WHILE 4 tabs outputting')
    await A.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForTerminalApi(A.page)
    await waitForXtermFit(A.page)
    await A.page.waitForTimeout(1500)

    // Restart yes on pane 0
    await sendToPane(A.page, paneIds[0], 'yes\n')
    await A.page.waitForTimeout(1000)

    const aState1 = await readTerminalState(A.page)
    const bState1 = await readTerminalState(B.page)
    console.log(`  A after reconnect: screen=${aState1.screen?.w}x${aState1.screen?.h}`)
    console.log(`  B after A refresh: screen=${bState1.screen?.w}x${bState1.screen?.h}`)

    step('B does MORE fast wheel up/down for 3s (post-refresh)')
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

    step('sample B write pump health AGAIN (post-refresh + scroll)')
    const pumpHealth2 = await samplePumpHealth(B.page, B.wsFrames)
    console.log(`  scrollHeight growth: ${pumpHealth2.heightGrowth}px over 2s`)
    console.log(`  WS frames received: ${pumpHealth2.wsGrowth} over 2s`)
    console.log(`  pump alive: ${pumpHealth2.pumpAlive ? 'yes' : 'NO (write pump dead!)'}`)
    for (const s of pumpHealth2.samples) {
      console.log(`    t+${s.t}ms: scrollHeight=${s.scrollHeight} wsFrames=${s.wsFrames}`)
    }

    step('post-refresh echo test (stop yes, send marker, check WS + buffer)')
    const postResult = await testEcho(B.page, B.wsFrames, paneIds[0], 'POST')
    console.log(`  wsLatency: ${postResult.wsLatency}ms  inBuffer: ${postResult.inBuffer}`)
    console.log(`  bufferTail: ${JSON.stringify(postResult.bufferTail?.slice?.(-2) ?? postResult.bufferTail)}`)

    // Stop all yes
    for (const pid of paneIds) {
      await sendToPane(A.page, pid, '\x03').catch(() => {})
    }
    await A.page.waitForTimeout(500)

    step('verdict')
    console.log('\n========== VERDICT (aggressive v2) ==========')
    const sameScreen = bState1.screen?.w === aState1.screen?.w && bState1.screen?.h === aState1.screen?.h
    console.log(`A screen:  ${aState1.screen?.w}x${aState1.screen?.h}`)
    console.log(`B screen:  ${bState1.screen?.w}x${bState1.screen?.h}`)
    console.log(`B aligned with PTY: ${sameScreen ? 'yes' : 'NO (misaligned)'}`)
    console.log(`B baseline echo: ws=${baseResult.wsLatency}ms inBuffer=${baseResult.inBuffer}`)
    console.log(`B post-refresh echo: ws=${postResult.wsLatency}ms inBuffer=${postResult.inBuffer}`)
    console.log(`B pump health (pre-refresh): ${pumpHealth.pumpAlive ? 'alive' : 'DEAD'} (height+${pumpHealth.heightGrowth} ws+${pumpHealth.wsGrowth})`)
    console.log(`B pump health (post-refresh): ${pumpHealth2.pumpAlive ? 'alive' : 'DEAD'} (height+${pumpHealth2.heightGrowth} ws+${pumpHealth2.wsGrowth})`)

    const pumpDied = !pumpHealth2.pumpAlive || (pumpHealth.pumpAlive && !pumpHealth2.pumpAlive)
    const echoInWsButNotBuffer = postResult.wsLatency > 0 && !postResult.inBuffer

    if (pumpDied) {
      console.log('=> REPRODUCED P1: B write pump dead after A refresh + scroll')
    } else if (echoInWsButNotBuffer) {
      console.log('=> REPRODUCED P1: shell echoed but B did not render (write pump dead)')
    } else if (!sameScreen) {
      console.log('=> B misaligned but pump alive (resize issue, no P1)')
    } else {
      console.log('=> NOT reproduced')
    }
    console.log('==============================================\n')

    if (KEEP_OPEN) {
      console.log('KEEP_OPEN=1 - leaving browser open. Press Ctrl+C to exit.')
      await new Promise(() => {})
    }
  } finally {
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
