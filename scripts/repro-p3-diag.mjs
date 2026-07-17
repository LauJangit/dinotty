// Quick diagnostic: verify WS hook captures real keyboard input.
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:8999'
const TOKEN = process.env.DINOTTY_TOKEN

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const resp = await ctx.request.post(`${URL}/api/auth`, { data: { token: TOKEN } })
if (!resp.ok()) { console.error('login failed'); process.exit(1) }

const page = await ctx.newPage()

// Hook WS send
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

// Capture WS creation to confirm WS is used
page.on('websocket', ws => {
  console.log('[ws] opened:', ws.url())
  ws.on('framesent', f => {
    if (typeof f.payload === 'string' && f.payload.includes('"type":"input"')) {
      console.log('[ws framesent]', f.payload.slice(0, 100))
    }
  })
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dinotty_terminal_api?.listPanes, { timeout: 15000 })
console.log('[api] ready')

// Wait for xterm
await page.waitForFunction(() => !!document.querySelector('.xterm-helper-textarea'), { timeout: 10000 })
console.log('[xterm] textarea attached')

// Focus the textarea and type a real character
await page.evaluate(() => {
  const ta = document.querySelector('.xterm-helper-textarea')
  ta.focus()
})
await page.waitForTimeout(200)

// Type 'A' via real keyboard
await page.keyboard.type('A', { delay: 0 })
await page.waitForTimeout(500)

const inputs = await page.evaluate(() => window.__p3_inputs)
console.log('[inputs after real keyboard.type("A")]:', JSON.stringify(inputs))

// Also try clicking the terminal first
await page.evaluate(() => {
  const term = document.querySelector('.terminal')
  if (term) {
    const rect = term.getBoundingClientRect()
    console.log('[terminal rect]', rect.x, rect.y, rect.width, rect.height)
  }
})

// Click on the terminal pane container to focus
const paneContainer = await page.$('.terminal-pane-container')
if (paneContainer) {
  await paneContainer.click()
  await page.waitForTimeout(200)
  await page.keyboard.type('B', { delay: 0 })
  await page.waitForTimeout(500)
}

const inputs2 = await page.evaluate(() => window.__p3_inputs)
console.log('[inputs after click + type("B")]:', JSON.stringify(inputs2))

// Check what transport is in use
const transportInfo = await page.evaluate(() => {
  return {
    isTauri: !!(window.__TAURI__ || window.isTauri),
    hasWebSocket: typeof WebSocket !== 'undefined',
    websocketCount: (window.__ws_instances || []).length,
  }
})
console.log('[transport]:', JSON.stringify(transportInfo))

await browser.close()
