#!/usr/bin/env node
// Repro for P3: focusActive() has no isComposing guard.
//
// Mechanism (from investigate doc, live-confirmed):
// 1. User starts IME composition (e.g. pinyin 'ni').
// 2. Peer-sync event fires focusActive() which calls .focus() on the
//    active pane's xterm textarea (and .blur() on siblings).
// 3. The .blur() aborts the in-flight composition. Browser auto-fires
//    compositionend with the *current preedit* (e.g. 'ni'), not the
//    would-be committed char ('你').
// 4. xterm's compositionend handler (_finalizeComposition) reads
//    textarea.value and fires onData with the preedit text.
//    -> 'ni' leaks to the PTY as committed text.
// 5. Subsequent keydowns (keyCode 229, no composition events) hit
//    _handleAnyTextareaChanges diff-fallback, sending more raw deltas.
//
// This script reproduces the leak via synth events on the VISIBLE
// xterm textarea. The bug mechanism is identical to a real IME; only
// the event source differs.
//
// Run:
//   DINOTTY_TOKEN=$(cat "/Users/talentc/Library/Application Support/dinotty/token") \
//   DINOTTY_URL=http://127.0.0.1:8999 \
//   node scripts/repro-p3-ime-focusactive.mjs
// Optional: HEADED=1, KEEP_OPEN=1

import { chromium } from 'playwright'

const URL = process.env.DINOTTY_URL ?? 'http://127.0.0.1:8999'
const TOKEN = process.env.DINOTTY_TOKEN
const HEADED = !!process.env.HEADED
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

  // Hook WS send to capture all input frames.
  await page.addInitScript(() => {
    window.__p3_inputs = []
    const origSend = WebSocket.prototype.send
    WebSocket.prototype.send = function (payload) {
      try {
        if (typeof payload === 'string' && payload.includes('"type":"input"')) {
          const msg = JSON.parse(payload)
          if (msg && msg.type === 'input') {
            window.__p3_inputs.push({ data: msg.data, t: performance.now() })
          }
        }
      } catch {}
      return origSend.call(this, payload)
    }
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitForTerminalApi(page)
  return { ctx, page, label }
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

// Run a function on the visible xterm textarea.
async function onVisibleTextarea(page, fn) {
  return await page.evaluate((fnSrc) => {
    const containers = Array.from(document.querySelectorAll('.terminal-pane-container'))
    const visible = containers.find(c => c.getBoundingClientRect().width > 10)
    if (!visible) throw new Error('no visible container')
    const ta = visible.querySelector('.xterm-helper-textarea')
    if (!ta) throw new Error('no textarea in visible container')
    const fn = new Function('ta', fnSrc)
    return fn(ta)
  }, fn.toString().replace(/^\s*\(ta\)\s*=>\s*\{?/, '').replace(/\}?\s*$/, ''))
}

async function resetInputs(page) {
  await page.evaluate(() => { window.__p3_inputs = [] })
}

async function readInputs(page) {
  return await page.evaluate(() => window.__p3_inputs || [])
}

async function main() {
  console.log(`target: ${URL}`)
  console.log(`headed: ${HEADED}`)

  const browser = await chromium.launch({ headless: !HEADED })
  const A = await loginAndOpen(browser, 'A')
  let testPaneId = null

  try {
    step('A creates a fresh test tab')
    testPaneId = await createTab(A.page, A.ctx)
    if (!testPaneId) { console.log('FATAL: no pane'); process.exit(3) }
    console.log(`  test paneId: ${testPaneId}`)

    step('wait for visible xterm textarea')
    await A.page.waitForFunction(() => {
      const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
      return cs.some(c => c.getBoundingClientRect().width > 10 && c.querySelector('.xterm-helper-textarea'))
    }, { timeout: 10000 })
    await A.page.waitForTimeout(500)

    step('CASE 1: clean composition (compositionstart/update/end) - correct path')
    await resetInputs(A.page)
    await A.page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
      const visible = cs.find(c => c.getBoundingClientRect().width > 10)
      const ta = visible.querySelector('.xterm-helper-textarea')
      ta.focus()
      ta.value = ''
      ta.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
      ta.value = 'ni'
      ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }))
      ta.value = '你'
      ta.dispatchEvent(new CompositionEvent('compositionend', { data: '你' }))
    })
    await A.page.waitForTimeout(300)
    const cleanInputs = await readInputs(A.page)
    console.log(`  clean composition inputs: ${JSON.stringify(cleanInputs.map(i => i.data))}`)
    console.log(`  expected: ["你"] (one commit)`)
    const cleanOk = cleanInputs.length === 1 && cleanInputs[0].data === '你'
    console.log(`  result: ${cleanOk ? 'OK (baseline)' : 'UNEXPECTED'}`)

    step('CASE 2: focusActive interrupts composition - broken path (no compositionstart)')
    // The real bug trigger: focusActive interferes BEFORE compositionstart
    // fires (e.g. focus steal during the initial keydown). The browser then
    // never enters the clean composition path - it emits keydown 229s + input
    // events with NO composition events. xterm._isComposing stays false, so
    // every keydown 229 hits _handleAnyTextareaChanges diff-fallback, sending
    // each textarea value delta as raw input. Preedit letters leak.
    //
    // We reproduce by dispatching the broken-path sequence: keydown 229 ->
    // set value -> let setTimeout fire -> next keydown. No composition events.
    await resetInputs(A.page)
    // Sequence: 'd' -> 'de' -> '的' (mimics pinyin input)
    const seq = ['d', 'de', '的']
    for (const val of seq) {
      await A.page.evaluate((v) => {
        const cs = Array.from(document.querySelectorAll('.terminal-pane-container'))
        const visible = cs.find(c => c.getBoundingClientRect().width > 10)
        const ta = visible.querySelector('.xterm-helper-textarea')
        // Dispatch keydown 229 FIRST (before value update, like real browser)
        const kd = new KeyboardEvent('keydown', { keyCode: 229, which: 229, bubbles: true, cancelable: true })
        Object.defineProperty(kd, 'keyCode', { get: () => 229 })
        Object.defineProperty(kd, 'which', { get: () => 229 })
        ta.dispatchEvent(kd)
        // Then update value + dispatch input event
        ta.value = v
        ta.dispatchEvent(new InputEvent('input', { data: v, inputType: 'insertText', bubbles: true }))
      }, val)
      // Let the diff-fallback setTimeout fire before next iteration
      await A.page.waitForTimeout(50)
    }
    await A.page.waitForTimeout(200)
    const bugInputs = await readInputs(A.page)
    console.log(`  broken-path inputs: ${JSON.stringify(bugInputs.map(i => i.data))}`)
    console.log(`  expected if bug fires: ['d','e','的'] (preedit chars leak as raw input)`)
    console.log(`  expected if no bug:    ['的'] only (single commit)`)
    const leakDetected = bugInputs.length >= 2
    const leakPattern = bugInputs.map(i => i.data).join('')
    console.log(`  result: ${leakDetected ? `REPRODUCED - ${bugInputs.length} frames sent (preedit leaked)` : 'not reproduced'}`)
    console.log(`  leaked pattern: "${leakPattern}"`)

    step('verdict')
    console.log('\n========== VERDICT (P3) ==========')
    console.log(`Clean composition:           ${cleanOk ? 'OK (baseline)' : 'unexpected'}`)
    console.log(`focusActive broken path:     ${leakDetected ? `PREEDIT LEAK (bug reproduced, ${bugInputs.length} frames)` : 'not reproduced'}`)
    console.log(`  leaked pattern:            "${leakPattern}"`)
    console.log('')
    console.log('Code-level: focusActive() at App.vue:924 has NO isComposing guard.')
    console.log('It calls .blur() on siblings + .focus() + .fit() on active unconditionally,')
    console.log('fired from 11+ peer-sync / nextTick sites. When focusActive interferes')
    console.log('before compositionstart fires, xterm._isComposing stays false and every')
    console.log('keydown 229 hits the diff-fallback, leaking preedit chars as raw input.')
    console.log('==================================\n')

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
