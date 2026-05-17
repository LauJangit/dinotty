<template>
  <div>
    <section class="settings-section">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.cpuChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.cpu" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="chart-wrap">
        <Line :data="cpuChartData" :options="pctChartOptions" />
      </div>
    </section>

    <section class="settings-section">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.memChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.memory" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="chart-wrap">
        <Line :data="memChartData" :options="pctChartOptions" />
      </div>
    </section>

    <section class="settings-section">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.diskLabel') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.disk" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div v-if="data" class="disk-info">
        <div v-for="(d, i) in data.disk" :key="i" class="settings-row">
          <label>{{ d.mount }}</label>
          <span class="disk-val">{{ fmtBytes(d.used) }} / {{ fmtBytes(d.total) }} ({{ d.usage.toFixed(0) }}%)</span>
        </div>
      </div>
      <div v-else class="disk-info"><span class="disk-val">—</span></div>
    </section>

    <section class="settings-section">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.netChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.network" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="chart-wrap">
        <Line :data="netChartData" :options="netChartOptions" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { monitorData } from '../../composables/useMonitor'
import { cpuHistory, memHistory, netRxHistory, netTxHistory } from '../../composables/useMonitor'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const { settings } = useSettings()
const { t } = useI18n()
const data = monitorData

const labels = computed(() => cpuHistory.value.map(() => ''))

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 0 } as const,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 1.5 } },
  scales: {
    x: { display: false },
    y: {
      min: 0,
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } },
    },
  },
}

const pctChartOptions = {
  ...baseOptions,
  scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, max: 100 } },
}

function fmtRate(v: number): string {
  if (v < 1024) return `${v}B/s`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)}K/s`
  return `${(v / 1024 / 1024).toFixed(1)}M/s`
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}M`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)}G`
}

const netChartOptions = {
  ...baseOptions,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    ...baseOptions.scales,
    y: {
      ...baseOptions.scales.y,
      ticks: {
        ...baseOptions.scales.y.ticks,
        callback: (v: number | string) => fmtRate(Number(v)),
      },
    },
  },
}

const cpuChartData = computed(() => ({
  labels: labels.value,
  datasets: [{
    data: [...cpuHistory.value],
    borderColor: '#4d7fff',
    backgroundColor: 'rgba(77,127,255,0.1)',
    fill: true,
  }],
}))

const memChartData = computed(() => ({
  labels: labels.value,
  datasets: [{
    data: [...memHistory.value],
    borderColor: '#34d399',
    backgroundColor: 'rgba(52,211,153,0.1)',
    fill: true,
  }],
}))

const netChartData = computed(() => ({
  labels: labels.value,
  datasets: [
    {
      data: [...netTxHistory.value],
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245,158,11,0.05)',
      fill: true,
    },
    {
      data: [...netRxHistory.value],
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139,92,246,0.05)',
      fill: true,
    },
  ],
}))
</script>

<style scoped>
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.chart-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}
.chart-wrap {
  height: 120px;
  position: relative;
}
.disk-info {
  font-size: 12px;
}
.disk-val {
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted, #666);
  font-size: 12px;
}
</style>
