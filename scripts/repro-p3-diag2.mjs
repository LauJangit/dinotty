// Diagnostic 2: probe whether WS send is the input path.
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:8999'
const TOKEN = process.env.DINOTTY_TOKEN

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
if (!resp.ok()) { console.error('login failed'); process.exit(1) }

const page = await ctx.newPage()

await page.addInitScript(() => {
  window.__p3_inputs = []
  const origSend = WebSocket.prototype.send
  WebSocket.prototype.send = function (payload) {
    try {
      if (typeof payload === 'string' && payload.includes('"type":"input"')) {
        const msg = JSON.parse(payload)
        if (msg && msg.type === 'input') {
          window.__p3_inputs.push({ data: msg.data, t: performance.now(), url: this.url })
        }
      }
    } catch {}
    return origSend.call(this, payload)
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })

// Create a tab via API
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
console.log('paneId:', paneId)

// Wait for xterm
await page.waitForFunction(() => !!document.querySelector('.xterm-helper-textarea'), { timeout: 10000 })
await page.waitForTimeout(800)

// Check transport + active state
const info = await page.evaluate(() => {
  return {
    isTauri: !!(window.__TAURI__ || window.isTauri),
    panes: window.__dinotty_terminal_api.listPanes(),
    textareaCount: document.querySelectorAll('.xterm-helper-textarea').length,
    visibleContainers: Array.from(document.querySelectorAll('.terminal-pane-container')).filter(c => {
      const r = c.getBoundingClientRect()
      return r.width > 10 && r.height > 10
    }).length,
  }
})
console.log('info:', JSON.stringify(info, null, 2))

// Send via API
await page.evaluate(({pid}) => {
  window.__dinotty_terminal_api.send(pid, 'Z')
}, {pid: paneId})
await page.waitForTimeout(300)

const inputs1 = await page.evaluate(() => window.__p3_inputs)
console.log('after API send("Z"):', JSON.stringify(inputs1))

// Now focus textarea and type via real keyboard
await page.evaluate(() => {
  const ta = document.querySelector('.xterm-helper-textarea')
  if (ta) ta.focus()
})
await page.waitForTimeout(100)
await page.keyboard.type('A', { delay: 0 })
await page.waitForTimeout(300)

const inputs2 = await page.evaluate(() => window.__p3_inputs)
console.log('after keyboard.type("A"):', JSON.stringify(inputs2))

await browser.close()
