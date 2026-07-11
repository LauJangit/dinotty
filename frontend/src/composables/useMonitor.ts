import { ref } from 'vue'
import { wsUrlWithToken } from './apiBase'
import { isTauri, tauriInvoke } from './useTransport'

export interface CpuData {
  usage: number
  cores: number[]
  core_count: { physical: number; logical: number }
  load_avg: [number, number, number]
}

export interface MemoryData {
  used: number
  available: number
  total: number
  usage: number
  swap_used: number
  swap_total: number
}

export interface DiskData {
  mount: string
  fs_type: string
  used: number
  available: number
  total: number
  usage: number
}

export interface NetworkData {
  name: string
  ip: string
  rx_rate: number
  tx_rate: number
  rx_total: number
  tx_total: number
}

export interface GpuData {
  name: string
  uuid: string
  utilization_gpu: number
  utilization_mem: number
  temperature: number
  power_draw: number
  power_limit: number
  fan_speed: number
  memory_used: number
  memory_total: number
  memory_usage: number
}

export interface MonitorData {
  cpu: CpuData
  memory: MemoryData
  disk: DiskData[]
  network: NetworkData[]
  gpu: GpuData[]
}

export type MonitorMessage = MonitorData | { type: 'history'; data: MonitorData[] }

export const monitorData = ref<MonitorData | null>(null)
export const monitorConnected = ref(false)

type MonitorListener = (data: MonitorData) => void
type HistoryListener = (data: MonitorData[]) => void

const listeners: MonitorListener[] = []
const historyListeners: HistoryListener[] = []

export function onMonitorData(fn: MonitorListener) {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export function onMonitorHistory(fn: HistoryListener) {
  historyListeners.push(fn)
  return () => {
    const i = historyListeners.indexOf(fn)
    if (i >= 0) historyListeners.splice(i, 1)
  }
}

let ws: WebSocket | null = null
let sse: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let started = false

function handleMessage(e: { data: string }) {
  try {
    const msg: MonitorMessage = JSON.parse(e.data)
    if ('type' in msg && msg.type === 'history') {
      for (const fn of historyListeners) fn(msg.data)
      if (msg.data.length > 0) {
        monitorData.value = msg.data[msg.data.length - 1]
      }
    } else {
      const d = msg as MonitorData
      monitorData.value = d
      for (const fn of listeners) fn(d)
    }
  } catch {}
}

function connectSse() {
  console.log('[monitor] WebSocket unavailable, falling back to HTTP SSE')
  if (ws) {
    ws.close()
    ws = null
  }
  sse = new EventSource('/http/monitor')
  sse.onopen = () => {
    monitorConnected.value = true
    attempts = 0
  }
  sse.onmessage = handleMessage
  sse.onerror = () => {
    // EventSource auto-reconnects
  }
}

async function connect() {
  if (ws && ws.readyState <= WebSocket.OPEN) return
  if (sse) return

  let url: string
  if (isTauri()) {
    const origin = String(await tauriInvoke('embedded_http_origin')).replace(/\/$/, '')
    url = `${origin.replace(/^http/, 'ws')}/ws/monitor`
  } else {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url = `${proto}//${location.host}/ws/monitor`
  }

  ws = new WebSocket(wsUrlWithToken(url))

  ws.onopen = () => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    monitorConnected.value = true
    attempts = 0
  }

  ws.onmessage = (e) => handleMessage(e)

  ws.onclose = () => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    monitorConnected.value = false
    ws = null
    // Don't reconnect if already using SSE fallback
    if (sse) return
    if (started) scheduleReconnect()
  }

  ws.onerror = () => {}

  // If WS doesn't connect within 3 seconds, fall back to SSE
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null
    if (ws && ws.readyState !== WebSocket.OPEN) {
      connectSse()
    }
  }, 3000)
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(1000 * Math.pow(2, attempts), 30000)
  attempts++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (started) connect()
  }, delay)
}

export function startMonitor() {
  if (started) return
  started = true
  connect()
}

export function stopMonitor() {
  started = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  if (ws) {
    ws.close(1000)
    ws = null
  }
  if (sse) {
    sse.close()
    sse = null
  }
  monitorConnected.value = false
}

// ── Monitor History ──────────────────────────────────────────────

const MAX_HISTORY = 60

export const cpuHistory = ref<number[]>([])
export const memHistory = ref<number[]>([])
export const netRxHistory = ref<number[]>([])
export const netTxHistory = ref<number[]>([])
export const gpuUtilHistory = ref<number[][]>([])
export const gpuMemHistory = ref<number[][]>([])

let historyInitialized = false

function pushHistory<T>(arr: T[], val: T) {
  arr.push(val)
  if (arr.length > MAX_HISTORY) arr.shift()
}

function processEntry(d: MonitorData) {
  pushHistory(cpuHistory.value, d.cpu.usage)
  pushHistory(memHistory.value, d.memory.usage)
  const rx = d.network.reduce((s, n) => s + n.rx_rate, 0)
  const tx = d.network.reduce((s, n) => s + n.tx_rate, 0)
  pushHistory(netRxHistory.value, rx)
  pushHistory(netTxHistory.value, tx)

  // Per-GPU utilization history
  const gpu = d.gpu ?? []
  const utilHist = gpuUtilHistory.value
  const memHist = gpuMemHistory.value
  while (utilHist.length < gpu.length) {
    utilHist.push([])
  }
  while (memHist.length < gpu.length) {
    memHist.push([])
  }
  for (let i = 0; i < gpu.length; i++) {
    pushHistory(utilHist[i], gpu[i].utilization_gpu)
    pushHistory(memHist[i], gpu[i].memory_usage)
  }
}

export function initMonitorHistory() {
  if (historyInitialized) return
  historyInitialized = true
  startMonitor()

  onMonitorHistory((history) => {
    cpuHistory.value = []
    memHistory.value = []
    netRxHistory.value = []
    netTxHistory.value = []
    gpuUtilHistory.value = []
    gpuMemHistory.value = []
    for (const d of history) {
      processEntry(d)
    }
  })

  onMonitorData(processEntry)
}
