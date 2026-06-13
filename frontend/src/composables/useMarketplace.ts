import { ref } from 'vue'
import { authFetch, apiUrl } from './apiBase'

export interface MarketPlugin {
  id: string
  name: string
  description: string
  description_zh?: string
  version: string
  icon?: string
  repo: string
  branch: string
  subdir?: string
  author?: string
  homepage?: string
  installed_version?: string
  has_update: boolean
}

export function useMarketplace() {
  const plugins = ref<MarketPlugin[]>([])
  const loading = ref(false)
  const error = ref('')
  const installing = ref<Set<string>>(new Set())

  function markInstalling(id: string) {
    installing.value = new Set([...installing.value, id])
  }
  function unmarkInstalling(id: string) {
    const next = new Set(installing.value)
    next.delete(id)
    installing.value = next
  }

  async function fetchMarket() {
    loading.value = true
    error.value = ''
    try {
      const url = apiUrl('/api/plugins/market')
      let res: Response
      try {
        res = await authFetch(url)
      } catch {
        // Network-level failure (connection refused, DNS, etc.) — retry once
        await new Promise(r => setTimeout(r, 1500))
        res = await authFetch(url)
      }
      if (!res.ok) {
        // Auto-retry once on transient server errors (cold start / gateway issues)
        if (res.status >= 500) {
          await new Promise(r => setTimeout(r, 1500))
          res = await authFetch(url)
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      plugins.value = await res.json()
    } catch (e: any) {
      error.value = e.message || 'fetch failed'
    } finally {
      loading.value = false
    }
  }

  async function fetchReadme(id: string): Promise<string | null> {
    try {
      const res = await authFetch(apiUrl(`/api/plugins/market/${encodeURIComponent(id)}/readme`))
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  async function installFromMarket(plugin: MarketPlugin): Promise<{ ok: boolean; error?: string }> {
    markInstalling(plugin.id)
    try {
      const res = await authFetch(apiUrl('/api/plugins/install-git'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: plugin.repo,
          branch: plugin.branch,
          subdir: plugin.subdir,
        }),
      })
      if (res.ok) return { ok: true }
      const err = await res.json().catch(() => ({ error: 'Install failed' }))
      return { ok: false, error: err.error || 'Install failed' }
    } finally {
      unmarkInstalling(plugin.id)
    }
  }

  return { plugins, loading, error, installing, fetchMarket, fetchReadme, installFromMarket }
}
