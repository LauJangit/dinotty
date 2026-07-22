import { computed } from 'vue'
import { effectiveTheme } from './useDeviceThemeSelection'

export const gpuColors = [
  '#76b900',
  '#00a8e8',
  '#e84040',
  '#f59e0b',
  '#8b5cf6',
  '#34d399',
  '#f472b6',
  '#fbbf24',
  '#60a5fa',
  '#a78bfa',
]

/** Read CSS variable from the document root (canvas cannot resolve var()). */
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export function fmtRate(v: number): string {
  if (v < 1024) return `${v}B/s`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)}K/s`
  return `${(v / 1024 / 1024).toFixed(1)}M/s`
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}M`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)}G`
}

// Access theme preset to create a reactive dependency - re-evaluates on theme change.
export const baseOptions = computed(() => {
  void effectiveTheme.value
  const borderColor = cssVar('--border', '#3C3C3C')
  const fgMuted = cssVar('--fg-muted', '#858585')
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 } as const,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 1.5 } },
    scales: {
      x: { display: false },
      y: {
        min: 0,
        grid: { color: borderColor },
        ticks: { color: fgMuted, font: { size: 10 } },
      },
    },
  }
})

export const pctChartOptions = computed(() => ({
  ...baseOptions.value,
  scales: { ...baseOptions.value.scales, y: { ...baseOptions.value.scales.y, max: 100 } },
}))

export const autoChartOptions = computed(() => ({
  ...baseOptions.value,
  scales: {
    ...baseOptions.value.scales,
    y: { ...baseOptions.value.scales.y, beginAtZero: true },
  },
}))

export const netChartOptions = computed(() => ({
  ...baseOptions.value,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    ...baseOptions.value.scales,
    y: {
      ...baseOptions.value.scales.y,
      ticks: {
        ...baseOptions.value.scales.y.ticks,
        callback: (v: number | string) => fmtRate(Number(v)),
      },
    },
  },
}))

export function labelsFor(length: number): string[] {
  return Array.from({ length }, () => '')
}
