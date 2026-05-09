import { ref, watch } from 'vue'
import { monitorData, startMonitor } from './useMonitor'
import type { MonitorData } from './useMonitor'

const MAX_HISTORY = 60

export const cpuHistory = ref<number[]>([])
export const memHistory = ref<number[]>([])
export const netRxHistory = ref<number[]>([])
export const netTxHistory = ref<number[]>([])

let initialized = false

function push<T>(arr: T[], val: T) {
  arr.push(val)
  if (arr.length > MAX_HISTORY) arr.shift()
}

export function initMonitorHistory() {
  if (initialized) return
  initialized = true
  startMonitor()
  watch(monitorData, (d: MonitorData | null) => {
    if (!d) return
    push(cpuHistory.value, d.cpu.usage)
    push(memHistory.value, d.memory.usage)
    const rx = d.network.reduce((s, n) => s + n.rx_rate, 0)
    const tx = d.network.reduce((s, n) => s + n.tx_rate, 0)
    push(netRxHistory.value, rx)
    push(netTxHistory.value, tx)
  })
}
