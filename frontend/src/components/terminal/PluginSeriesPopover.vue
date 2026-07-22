<template>
  <Teleport to="body">
    <div
      v-if="visible && series"
      ref="popoverEl"
      class="plugin-series-popover"
      :style="popoverStyle"
      @click.stop
    >
      <div class="popover-header">{{ series.label }}</div>
      <div class="chart-wrap">
        <Line :data="chartData" :options="chartOptions" />
      </div>
      <div v-if="detailRows.length" class="detail-rows">
        <div v-for="(row, i) in detailRows" :key="i" class="detail-row">
          <span class="detail-label">{{ row.label }}</span>
          <span class="detail-value">{{ row.value }}</span>
        </div>
      </div>
      <div v-if="series.autoHidden" class="error-hint">
        {{ series.lastError ?? 'render error' }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import type { RegisteredSeries } from '../../stores/pluginMonitor'
import {
  baseOptions,
  pctChartOptions,
  autoChartOptions,
  gpuColors,
} from '../../composables/useChartOptions'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

const props = defineProps<{
  visible: boolean
  series: RegisteredSeries | null
  anchorRect: DOMRect | null
}>()

const emit = defineEmits<{ close: [] }>()

const popoverEl = ref<HTMLElement>()

const detailRows = computed(() => {
  if (!props.series?.detail) return []
  try {
    return props.series.detail()
  } catch {
    return []
  }
})

const chartData = computed(() => {
  const s = props.series
  if (!s) return { labels: [], datasets: [] }
  const history = s.history
  const labels = (history[0] ?? []).map(() => '')
  if (history.length === 1) {
    return {
      labels,
      datasets: [
        {
          data: [...history[0]],
          borderColor: s.color ?? '#8A8A8A',
          backgroundColor: 'rgba(138,138,138,0.1)',
          fill: true,
        },
      ],
    }
  }
  return {
    labels,
    datasets: history.map((h, i) => {
      const ms = s.multiSeries?.()
      const color = ms?.[i]?.color ?? gpuColors[i % gpuColors.length]
      return {
        label: ms?.[i]?.label,
        data: [...h],
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        fill: false,
      }
    }),
  }
})

const chartOptions = computed(() => {
  if (!props.series) return autoChartOptions.value
  // Reuse the shared options (theme-reactive).
  return props.series.scale === 'percent' ? pctChartOptions.value : autoChartOptions.value
})

void baseOptions

const popoverStyle = computed(() => {
  if (!props.anchorRect) return {}
  const pw = 260
  const margin = 8
  let x = props.anchorRect.left + props.anchorRect.width / 2
  const halfW = pw / 2
  if (x - halfW < margin) x = margin + halfW
  if (x + halfW > window.innerWidth - margin) x = window.innerWidth - margin - halfW
  return {
    left: `${x}px`,
    bottom: `${window.innerHeight - props.anchorRect.top + 6}px`,
    transform: 'translateX(-50%)',
    maxHeight: `${props.anchorRect.top - 12}px`,
  }
})

function onClickOutside(e: MouseEvent) {
  if (popoverEl.value && !popoverEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

let clickListenerActive = false
function addClickListener() {
  if (clickListenerActive) return
  clickListenerActive = true
  setTimeout(() => document.addEventListener('click', onClickOutside), 0)
}
function removeClickListener() {
  if (!clickListenerActive) return
  clickListenerActive = false
  document.removeEventListener('click', onClickOutside)
}

onBeforeUnmount(() => {
  removeClickListener()
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      addClickListener()
    } else {
      removeClickListener()
    }
  },
)
</script>

<style scoped>
.plugin-series-popover {
  position: fixed;
  width: 260px;
  background: var(--bg, #1a1a2e);
  border: 1px solid var(--border);
  border-radius: var(--radius, 4px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  padding: 8px;
  box-sizing: border-box;
  overflow-y: auto;
}
.popover-header {
  font-size: 12px;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.chart-wrap {
  height: 80px;
  position: relative;
}
.detail-rows {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.detail-label {
  color: var(--fg-muted);
}
.detail-value {
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.error-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--danger);
}
</style>
