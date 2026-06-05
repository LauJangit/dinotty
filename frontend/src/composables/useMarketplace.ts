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

  async function fetchMarket() {
    loading.value = true
    error.value = ''
    try {
      const res = await authFetch(apiUrl('/api/plugins/market'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      plugins.value = await res.json()
    } catch (e: any) {
      error.value = e.message || 'fetch failed'
    } finally {
      loading.value = false
    }
  }

  async function installFromMarket(plugin: MarketPlugin): Promise<{ ok: boolean; error?: string }> {
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
  }

  async function installFromGitUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    // Parse "owner/repo" or full GitHub URL
    let repo = url.trim()
    if (repo.startsWith('https://github.com/')) {
      repo = repo.replace('https://github.com/', '').replace(/\.git$/, '').replace(/\/$/, '')
    }
    const res = await authFetch(apiUrl('/api/plugins/install-git'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, branch: 'main' }),
    })
    if (res.ok) return { ok: true }
    const err = await res.json().catch(() => ({ error: 'Install failed' }))
    return { ok: false, error: err.error || 'Install failed' }
  }

  return { plugins, loading, error, fetchMarket, installFromMarket, installFromGitUrl }
}
