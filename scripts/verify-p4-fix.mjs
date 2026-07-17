#!/usr/bin/env node
// P4 fix verification: 2ms dedup is gated to Tauri only.
//
// Pre-fix: isDuplicateOnData ran on ALL platforms, dropping fast identical
// repeats (e.g. `3000000` -> `30`, held arrow keys, fast paste).
//
// Post-fix: dedup is gated to isTauri(). On web, all fast repeats pass
// through. On Tauri, dedup is preserved to absorb WKWebView multi-focus
// replay.
//
// This script runs on the web dev server (5175) and verifies:
// 1. 7 rapid '0' chars via synth InputEvent all reach the WS (no drop)
// 2. 5 rapid arrow-key sequences all reach the WS
//
// Run:
//   DINOTTY_TOKEN=$(cat "/Users/talentc/Library/Application Support/dinotty/token") \
//   DINOTTY_URL=http://127.0.0.1:5175 \
//   node scripts/verify-p4-fix.mjs

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:5175'
const TOKEN = process.env.DINOTTY_TOKEN

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
  if (!resp.ok()) throw new Error(`login failed: ${resp.status()}`)
  const page = await ctx.newPage()

  await page.addInitScript(() => {
    window.__p4_inputs = []
    const origSend = WebSocket.prototype.send
    WebSocket.prototype.send = function (payload) {
      try {
        if (typeof payload === 'string' && payload.includes('"type":"input"')) {
          const msg = JSON.parse(payload)
          if (msg && msg.type === 'input') {
            window.__p4_inputs.push({ data: msg.data, t: performance.now() })
          }
        }
      } catch {}
      return origSend.call(this, payload)
    }
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitForTerminalApi(page)
  return { ctx, page }
}

async function createTab(page, ctx) {
  const before = await page.evaluate(() => window.__dinotty_terminal_api.listPanes().map(p => p.id))
  await page.evaluate(async () => { await window.__dinotty_terminal_api.createTab() })
  const paneId = await page.evaluate(async (beforeArr) => {
    const beforeSet = new Set(beforeArr)
    for (let i = 0; i < 80; i++) {
      const panes = window.__dinotty_terminal_api.listPanes()
      if (panes.length > beforeArr.length) {
        return panes.find(p => !beforeSet.has(p.id)).id
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

// Dispatch N rapid identical InputEvents on the visible xterm textarea.
// All events fire in the same synchronous tick (sub-ms timestamps), which
// is the worst case for the 2ms dedup.
async function dispatchRapidIdentical(page, ch, count) {
  await page.evaluate(({ch, count}) => {
    const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const visible = cs.find(c => c.getBoundingClientRect().width > 10)
    const ta = visible.querySelector('.xterm-helper-textarea')
    ta.focus()
    for (let i = 0; i < count; i++) {
      ta.value = ch
      ta.dispatchEvent(new InputEvent('input', {
        data: ch, inputType: 'insertText', bubbles: true, cancelable: true, composed: false
      }))
    }
  }, {ch, count})
}

async function main() {
  console.log(`target: ${URL}`)
  const browser = await chromium.launch({ headless: true })
  const A = await loginAndOpen(browser)
  let testPaneId = null

  try {
    step('create fresh test tab')
    testPaneId = await createTab(A.page, A.ctx)
    if (!testPaneId) { console.log('FATAL: no pane'); process.exit(3) }
    console.log(`  paneId: ${testPaneId}`)

    step('wait for visible xterm textarea')
    await A.page.waitForFunction(() => {
      const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
      return cs.some(c => c.getBoundingClientRect().width > 10 && c.querySelector('.xterm-helper-textarea'))
    }, { timeout: 10000 })
    await A.page.waitForTimeout(500)

    step('CASE 1: 7 rapid "0" chars via synth InputEvent (sub-ms)')
    await A.page.evaluate(() => { window.__p4_inputs = [] })
    await dispatchRapidIdentical(A.page, '0', 7)
    await A.page.waitForTimeout(200)
    const zeros = await A.page.evaluate(() => window.__p4_inputs)
    console.log(`  inputs: ${JSON.stringify(zeros.map(i => i.data))}`)
    console.log(`  count: ${zeros.length} (expected 7)`)
    console.log(`  time span: ${(zeros[zeros.length-1]?.t - zeros[0]?.t).toFixed(2)}ms`)
    const case1Ok = zeros.length === 7
    console.log(`  result: ${case1Ok ? 'OK (no drops)' : 'FAIL (chars dropped)'}`)

    step('CASE 2: 5 rapid arrow sequences (\\x1b[A)')
    await A.page.evaluate(() => { window.__p4_inputs = [] })
    await A.page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
      const visible = cs.find(c => c.getBoundingClientRect().width > 10)
      const ta = visible.querySelector('.xterm-helper-textarea')
      ta.focus()
      // Arrow keys produce \x1b[A via xterm's keydown handler, not InputEvent.
      // We dispatch 5 rapid keydown ArrowUp events.
      for (let i = 0; i < 5; i++) {
        ta.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38,
          bubbles: true, cancelable: true,
        }))
      }
    })
    await A.page.waitForTimeout(200)
    const arrows = await A.page.evaluate(() => window.__p4_inputs)
    console.log(`  inputs: ${JSON.stringify(arrows.map(i => i.data))}`)
    console.log(`  count: ${arrows.length} (expected 5)`)
    const case2Ok = arrows.length === 5
    console.log(`  result: ${case2Ok ? 'OK (no drops)' : 'FAIL (arrows dropped)'}`)

    step('CASE 3: control - distinct chars always pass')
    await A.page.evaluate(() => { window.__p4_inputs = [] })
    await A.page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
      const visible = cs.find(c => c.getBoundingClientRect().width > 10)
      const ta = visible.querySelector('.xterm-helper-textarea')
      ta.focus()
      for (const ch of ['a', 'b', 'c', 'd']) {
        ta.value = ch
        ta.dispatchEvent(new InputEvent('input', {
          data: ch, inputType: 'insertText', bubbles: true,
        }))
      }
    })
    await A.page.waitForTimeout(200)
    const distinct = await A.page.evaluate(() => window.__p4_inputs)
    console.log(`  inputs: ${JSON.stringify(distinct.map(i => i.data))}`)
    const case3Ok = distinct.length === 4
    console.log(`  result: ${case3Ok ? 'OK' : 'FAIL'}`)

    step('verdict')
    console.log('\n========== VERDICT (P4 fix) ==========')
    console.log(`7 rapid "0" chars (sub-ms):   ${case1Ok ? 'all pass' : 'DROPS'} (${zeros.length}/7)`)
    console.log(`5 rapid arrow sequences:      ${case2Ok ? 'all pass' : 'DROPS'} (${arrows.length}/5)`)
    console.log(`4 distinct chars (control):   ${case3Ok ? 'OK' : 'FAIL'} (${distinct.length}/4)`)
    const allOk = case1Ok && case2Ok && case3Ok
    console.log(``)
    console.log(`=> P4 fix ${allOk ? 'VERIFIED on web' : 'NOT VERIFIED'}`)
    console.log(`   (dedup gated to isTauri(); web has no dedup)`)
    console.log('======================================\n')

  } finally {
    if (testPaneId) await closeTabByPaneId(A.ctx, testPaneId).catch(() => {})
    await A.ctx.close()
    await browser.close()
  }
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
