// Diagnostic 3: do synth composition events fire xterm.onData?
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:8999'
const TOKEN = process.env.DINOTTY_TOKEN

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
const page = await ctx.newPage()

await page.addInitScript(() => {
  window.__p3_inputs = []
  const origSend = WebSocket.prototype.send
  WebSocket.prototype.send = function (payload) {
    try {
      if (typeof payload === 'string' && payload.includes('"type":"input"')) {
        const msg = JSON.parse(payload)
        if (msg && msg.type === 'input') window.__p3_inputs.push({ data: msg.data, t: performance.now() })
      }
    } catch {}
    return origSend.call(this, payload)
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })

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
}, before)
console.log('paneId:', paneId)

await page.waitForFunction(() => !!document.querySelector('.xterm-helper-textarea'), { timeout: 10000 })
await page.waitForTimeout(500)

// Focus textarea
await page.evaluate(() => document.querySelector('.xterm-helper-textarea').focus())
await page.waitForTimeout(100)

// Reset captures
await page.evaluate(() => { window.__p3_inputs = [] })

// TEST 1: synth compositionstart + compositionupdate + compositionend
console.log('\nTEST 1: synth composition events (compositionstart/update/end)')
await page.evaluate(() => {
  const ta = document.querySelector('.xterm-helper-textarea')
  ta.value = ''
  ta.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
  ta.value = 'ni'
  ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }))
  ta.value = '你'
  ta.dispatchEvent(new CompositionEvent('compositionend', { data: '你' }))
})
await page.waitForTimeout(300)
let inputs = await page.evaluate(() => window.__p3_inputs)
console.log('  inputs:', JSON.stringify(inputs))

// TEST 2: synth keydown with keyCode 229 + textarea value change
console.log('\nTEST 2: synth keydown 229 + textarea value change (diff-fallback path)')
await page.evaluate(() => { window.__p3_inputs = [] })
await page.evaluate(() => {
  const ta = document.querySelector('.xterm-helper-textarea')
  // Set initial value
  ta.value = 'abc'
  // Dispatch keydown 229 - xterm captures current value 'abc'
  const kd = new KeyboardEvent('keydown', { keyCode: 229, which: 229, bubbles: true, cancelable: true })
  Object.defineProperty(kd, 'keyCode', { get: () => 229 })
  Object.defineProperty(kd, 'which', { get: () => 229 })
  ta.dispatchEvent(kd)
  // Change value - the diff-fallback setTimeout will compute delta
  ta.value = 'abcX'
})
await page.waitForTimeout(300)
inputs = await page.evaluate(() => window.__p3_inputs)
console.log('  inputs:', JSON.stringify(inputs))

// TEST 3: real keyboard input (control)
console.log('\nTEST 3: real keyboard.type (control)')
await page.evaluate(() => { window.__p3_inputs = [] })
await page.evaluate(() => document.querySelector('.xterm-helper-textarea').focus())
await page.keyboard.type('C', { delay: 0 })
await page.waitForTimeout(300)
inputs = await page.evaluate(() => window.__p3_inputs)
console.log('  inputs:', JSON.stringify(inputs))

// TEST 4: synth input event (InputEvent)
console.log('\nTEST 4: synth InputEvent on textarea')
await page.evaluate(() => { window.__p3_inputs = [] })
await page.evaluate(() => {
  const ta = document.querySelector('.xterm-helper-textarea')
  ta.value = 'D'
  ta.dispatchEvent(new InputEvent('input', { data: 'D', inputType: 'insertText', bubbles: true, cancelable: false }))
})
await page.waitForTimeout(300)
inputs = await page.evaluate(() => window.__p3_inputs)
console.log('  inputs:', JSON.stringify(inputs))

await browser.close()
