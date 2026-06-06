<template>
  <div>
    <div class="plugin-tabs">
      <button
        class="plugin-tab"
        :class="{ active: tab === 'market' }"
        @click="tab = 'market'; detailPlugin = null"
      >{{ t('settings.plugins.market') }}</button>
      <button
        class="plugin-tab"
        :class="{ active: tab === 'installed' }"
        @click="tab = 'installed'; detailPlugin = null"
      >{{ t('settings.plugins.installed') }} ({{ settingsPlugins.length }})</button>
    </div>

    <div v-if="statusMsg" :class="statusOk ? 'plugin-success-msg' : 'plugin-error-msg'">{{ statusMsg }}</div>

    <!-- Market Tab -->
    <div v-show="tab === 'market' && !detailPlugin">
      <div v-if="marketLoading" class="plugin-empty">
        {{ t('settings.plugins.loading') }}
      </div>
      <div v-else-if="marketError" class="plugin-error-msg">
        {{ t('settings.plugins.fetchError') }}: {{ marketError }}
      </div>
      <div v-else-if="marketPlugins.length === 0" class="plugin-empty">
        {{ t('settings.plugins.noPlugins') }}
      </div>
      <div
        v-for="mp in marketPlugins"
        :key="mp.id"
        class="plugin-card plugin-card-clickable"
        @click="openDetail(mp)"
      >
        <div class="plugin-card-header">
          <span class="plugin-card-name">{{ mp.name }}</span>
          <span class="plugin-card-version">v{{ mp.version }}</span>
          <span v-if="mp.installed_version && !mp.has_update" class="plugin-badge installed">
            {{ t('settings.plugins.installedBadge') }}
          </span>
          <span v-if="mp.has_update" class="plugin-badge update">
            {{ t('settings.plugins.hasUpdate') }}
          </span>
        </div>
        <p class="plugin-card-desc">{{ locale === 'zh' && mp.description_zh ? mp.description_zh : mp.description }}</p>
        <div class="plugin-card-actions">
          <button v-if="!mp.installed_version" class="plugin-install-btn" @click.stop="onMarketInstall(mp)" :disabled="isBusy(mp.id)">
            <span v-if="isBusy(mp.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.installFromMarket') }}
          </button>
          <button v-else-if="mp.has_update" class="plugin-install-btn" @click.stop="onMarketInstall(mp)" :disabled="isBusy(mp.id)">
            <span v-if="isBusy(mp.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.updateFromMarket') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Market Detail View -->
    <div v-if="tab === 'market' && detailPlugin" class="plugin-detail">
      <div class="plugin-detail-header">
        <button class="plugin-back-btn" @click="detailPlugin = null">
          <span class="plugin-back-arrow">&larr;</span> {{ t('settings.plugins.back') }}
        </button>
      </div>

      <div class="plugin-detail-info">
        <div class="plugin-detail-title-row">
          <span class="plugin-detail-name">{{ detailPlugin.name }}</span>
          <span class="plugin-card-version">v{{ detailPlugin.version }}</span>
          <span v-if="detailPlugin.installed_version && !detailPlugin.has_update" class="plugin-badge installed">
            {{ t('settings.plugins.installedBadge') }}
          </span>
          <span v-if="detailPlugin.has_update" class="plugin-badge update">
            {{ t('settings.plugins.hasUpdate') }}
          </span>
        </div>
        <p v-if="detailPlugin.author" class="plugin-detail-author">{{ t('settings.plugins.author') }}: {{ detailPlugin.author }}</p>
        <p class="plugin-detail-desc">{{ locale === 'zh' && detailPlugin.description_zh ? detailPlugin.description_zh : detailPlugin.description }}</p>
        <div class="plugin-detail-actions">
          <button v-if="!detailPlugin.installed_version" class="plugin-install-btn" @click="onMarketInstall(detailPlugin)" :disabled="isBusy(detailPlugin.id)">
            <span v-if="isBusy(detailPlugin.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.installFromMarket') }}
          </button>
          <button v-else-if="detailPlugin.has_update" class="plugin-install-btn" @click="onMarketInstall(detailPlugin)" :disabled="isBusy(detailPlugin.id)">
            <span v-if="isBusy(detailPlugin.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.updateFromMarket') }}
          </button>
          <a v-if="detailPlugin.homepage" :href="detailPlugin.homepage" target="_blank" class="plugin-link">
            {{ t('settings.plugins.viewOnGithub') }}
          </a>
        </div>
      </div>

      <div class="plugin-detail-readme">
        <div v-if="readmeLoadingState" class="plugin-readme-loading">
          <span class="plugin-spinner"></span> {{ t('settings.plugins.loading') }}
        </div>
        <div v-else-if="readmeHtmlContent" class="plugin-readme-body" v-html="readmeHtmlContent"></div>
        <div v-else class="plugin-readme-empty">{{ t('settings.plugins.noReadme') }}</div>
      </div>
    </div>

    <!-- Installed Tab -->
    <div v-show="tab === 'installed'">
      <div class="plugin-toolbar">
        <label class="plugin-action-btn" :class="{ disabled: isBusy('file-install') }">
          <input type="file" accept=".tar.gz,.tgz" hidden @change="onInstallFile" :disabled="isBusy('file-install')" />
          <span v-if="isBusy('file-install')" class="plugin-spinner"></span>
          <span>{{ t('settings.plugins.installFile') }}</span>
        </label>
        <div class="plugin-toolbar-right">
          <input
            v-model="devPath"
            class="shortcut-input"
            style="width: 200px"
            placeholder="/path/to/my-plugin"
          />
          <button class="plugin-action-btn" @click="onDevLink" :disabled="!devPath.trim() || isBusy('dev-link')">
            <span v-if="isBusy('dev-link')" class="plugin-spinner"></span>
            {{ t('settings.plugins.devLink') }}
          </button>
        </div>
      </div>

      <div v-if="settingsPlugins.length === 0" class="plugin-empty">
        {{ t('settings.plugins.none') }}
      </div>
      <div v-for="p in settingsPlugins" :key="p.id" class="plugin-card">
        <div class="plugin-card-header">
          <span class="plugin-card-name">{{ p.name }}</span>
          <span v-if="p.state === 'error'" class="plugin-badge error">error</span>
          <span class="plugin-card-version">v{{ p.version }}</span>
        </div>
        <p v-if="p.description" class="plugin-card-desc">{{ p.description }}</p>
        <div class="plugin-card-actions">
          <button
            v-if="p.marketEntry"
            class="plugin-install-btn"
            @click="onUpdateFromRepo(p.marketEntry!)"
            :disabled="isBusy(p.id)"
          >
            <span v-if="isBusy(p.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.updateFromMarket') }}
          </button>
          <label v-else class="plugin-action-btn" :class="{ disabled: isBusy(`update:${p.id}`) }">
            <input type="file" accept=".tar.gz,.tgz" hidden @change="onUpdateFile($event, p.id)" :disabled="isBusy(`update:${p.id}`)" />
            <span v-if="isBusy(`update:${p.id}`)" class="plugin-spinner"></span>
            <span>{{ t('settings.plugins.update') }}</span>
          </label>
          <button class="plugin-action-btn plugin-danger" @click="onUninstall(p.id)" :disabled="isBusy(p.id)">
            {{ t('settings.plugins.uninstall') }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmModal
      :visible="!!confirmUninstall"
      :title="t('settings.plugins.uninstall')"
      :message="t('settings.plugins.confirmUninstall')"
      :target="confirmUninstall || undefined"
      :confirmText="t('settings.plugins.uninstall')"
      :cancelText="t('terminal.cancel')"
      @confirm="doUninstall"
      @cancel="confirmUninstall = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { authFetch, apiUrl } from '../../composables/apiBase'
import { usePluginLoader } from '../../composables/usePluginLoader'
import { useMarketplace, type MarketPlugin } from '../../composables/useMarketplace'
import ConfirmModal from '../ui/ConfirmModal.vue'

const { t, locale } = useI18n()
const { loadedPlugins, loadAll, unloadPlugin } = usePluginLoader()
const { plugins: marketPlugins, loading: marketLoading, error: marketError, installing, fetchMarket, fetchReadme, installFromMarket } = useMarketplace()

const tab = ref<'market' | 'installed'>('market')
const statusMsg = ref('')
const statusOk = ref(false)
const devPath = ref('')
const busyOps = ref<Set<string>>(new Set())
const confirmUninstall = ref<string | null>(null)

// Detail view state
const detailPlugin = ref<MarketPlugin | null>(null)
const readmeCache = ref<Map<string, string | null>>(new Map())
const readmeLoadingState = ref(false)

const readmeHtmlContent = computed(() => {
  if (!detailPlugin.value) return null
  const cached = readmeCache.value.get(detailPlugin.value.id)
  return cached ?? null
})

const settingsPlugins = computed(() =>
  Array.from(loadedPlugins.values()).map(p => ({
    id: p.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    state: p.state,
    marketEntry: marketPlugins.value.find(mp => mp.id === p.id),
  })),
)

function setStatus(msg: string, ok: boolean) {
  statusMsg.value = msg
  statusOk.value = ok
  setTimeout(() => { statusMsg.value = '' }, 4000)
}

function isBusy(key: string) {
  return installing.value.has(key) || busyOps.value.has(key)
}
function markBusy(key: string) {
  busyOps.value = new Set([...busyOps.value, key])
}
function unmarkBusy(key: string) {
  const next = new Set(busyOps.value)
  next.delete(key)
  busyOps.value = next
}

onMounted(() => fetchMarket())

async function renderMarkdown(src: string): Promise<string> {
  const [m, dp] = await Promise.all([import('marked'), import('dompurify')])
  const html = m.parse(src, { async: false }) as string
  return dp.default.sanitize(html)
}

async function openDetail(mp: MarketPlugin) {
  detailPlugin.value = mp
  if (readmeCache.value.has(mp.id)) return

  readmeLoadingState.value = true
  try {
    const md = await fetchReadme(mp.id)
    if (md) {
      const html = await renderMarkdown(md)
      readmeCache.value = new Map([...readmeCache.value, [mp.id, html]])
    } else {
      readmeCache.value = new Map([...readmeCache.value, [mp.id, null]])
    }
  } finally {
    readmeLoadingState.value = false
  }
}

async function onMarketInstall(mp: MarketPlugin) {
  const result = await installFromMarket(mp)
  if (result.ok) {
    setStatus(`Installed ${mp.name} v${mp.version}`, true)
    await loadAll()
    await fetchMarket()
    // Update detail plugin data
    const updated = marketPlugins.value.find(p => p.id === mp.id)
    if (updated) detailPlugin.value = updated
  } else {
    setStatus(result.error || 'Install failed', false)
  }
}

async function onUpdateFromRepo(mp: MarketPlugin) {
  const result = await installFromMarket(mp)
  if (result.ok) {
    setStatus(`Updated ${mp.name} to v${mp.version}`, true)
    await unloadPlugin(mp.id)
    await loadAll()
    await fetchMarket()
  } else {
    setStatus(result.error || 'Update failed', false)
  }
}

async function onInstallFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  markBusy('file-install')
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await authFetch(apiUrl('/api/plugins/install'), { method: 'POST', body: form })
    if (res.ok) {
      const manifest = await res.json()
      setStatus(`Installed ${manifest.name} v${manifest.version}`, true)
      await loadAll()
      await fetchMarket()
    } else {
      const err = await res.json().catch(() => ({ error: 'Install failed' }))
      setStatus(err.error || 'Install failed', false)
    }
  } finally {
    unmarkBusy('file-install')
    input.value = ''
  }
}

async function onUpdateFile(e: Event, id: string) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  markBusy(`update:${id}`)
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await authFetch(apiUrl(`/api/plugins/${id}/update`), { method: 'POST', body: form })
    if (res.ok) {
      const manifest = await res.json()
      setStatus(`Updated ${manifest.name} to v${manifest.version}`, true)
      await unloadPlugin(id)
      await loadAll()
      await fetchMarket()
    } else {
      const err = await res.json().catch(() => ({ error: 'Update failed' }))
      setStatus(err.error || 'Update failed', false)
    }
  } finally {
    unmarkBusy(`update:${id}`)
    input.value = ''
  }
}

function onUninstall(id: string) {
  confirmUninstall.value = id
}

async function doUninstall() {
  const id = confirmUninstall.value!
  confirmUninstall.value = null
  await unloadPlugin(id)
  const res = await authFetch(apiUrl(`/api/plugins/${id}`), { method: 'DELETE' })
  if (res.ok) {
    setStatus(`Uninstalled ${id}`, true)
    await fetchMarket()
  }
}

async function onDevLink() {
  const path = devPath.value.trim()
  if (!path) return
  markBusy('dev-link')
  try {
    const res = await authFetch(apiUrl('/api/plugins/dev-link'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (res.ok) {
      const manifest = await res.json()
      setStatus(`Linked ${manifest.name} from ${path}`, true)
      devPath.value = ''
      await loadAll()
      await fetchMarket()
    } else {
      const err = await res.json().catch(() => ({ error: 'Dev-link failed' }))
      setStatus(err.error || 'Dev-link failed', false)
    }
  } finally {
    unmarkBusy('dev-link')
  }
}
</script>

<style scoped>
.plugin-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border, #333);
  margin-bottom: 14px;
}
.plugin-tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted, #888);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.plugin-tab:hover {
  color: var(--text-primary, #ddd);
}
.plugin-tab.active {
  color: var(--fg-bright, #d0d0d0);
  border-bottom-color: var(--accent, #8a8a8a);
}
.plugin-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.plugin-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.plugin-install-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 5px;
  background: none;
  color: var(--fg-bright, #d0d0d0);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}
.plugin-install-btn:hover {
  background: rgba(255,255,255,0.06);
}
.plugin-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 5px;
  background: none;
  color: var(--fg-muted, #858585);
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition: background 0.15s, color 0.15s;
}
.plugin-action-btn:hover {
  background: rgba(255,255,255,0.06);
  color: var(--fg, #cccccc);
}
.plugin-danger {
  color: var(--fg-muted, #858585);
}
.plugin-danger:hover {
  color: var(--color-red, #ef4444);
  background: rgba(239,68,68,0.08);
}
.plugin-error-msg {
  margin: 8px 0;
  color: var(--color-red, #ef4444);
  font-size: 13px;
}
.plugin-success-msg {
  margin: 8px 0;
  color: var(--color-green, #34d399);
  font-size: 13px;
}
.plugin-empty {
  padding: 12px 0;
  color: var(--text-muted, #888);
  font-size: 13px;
}
.plugin-card {
  padding: 14px 16px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg-elevated, #222);
}
.plugin-card-clickable {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.plugin-card-clickable:hover {
  border-color: var(--fg-muted, #858585);
  background: var(--bg-surface-hover, #2a2a2a);
}
.plugin-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.plugin-card-name {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.4;
}
.plugin-card-version {
  font-size: 12px;
  color: var(--text-muted, #888);
  line-height: 1.4;
}
.plugin-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 1.4;
}
.plugin-badge.installed {
  color: var(--color-green, #34d399);
  background: rgba(52, 211, 153, 0.15);
}
.plugin-badge.update {
  color: var(--fg-muted, #858585);
  background: var(--bg-hover, #2a2a2c);
}
.plugin-badge.error {
  color: var(--color-red, #ef4444);
  background: rgba(239, 68, 68, 0.15);
}
.plugin-card-desc {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--text-secondary, #aaa);
  line-height: 1.5;
}
.plugin-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  align-items: center;
}
.plugin-link {
  font-size: 12px;
  color: var(--fg-muted, #858585);
  text-decoration: none;
  transition: color 0.15s;
}
.plugin-link:hover {
  color: var(--fg-bright, #d0d0d0);
}
.plugin-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--text-muted, #888);
  border-top-color: transparent;
  border-radius: 50%;
  animation: plugin-spin 0.6s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}
.plugin-install-btn .plugin-spinner {
  border-color: var(--fg-muted, #858585);
  border-top-color: transparent;
}
@keyframes plugin-spin {
  to { transform: rotate(360deg); }
}
.plugin-action-btn.disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* Detail view */
.plugin-detail-header {
  margin-bottom: 14px;
}
.plugin-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--fg-muted, #858585);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}
.plugin-back-btn:hover {
  color: var(--fg-bright, #d0d0d0);
}
.plugin-back-arrow {
  font-size: 16px;
  line-height: 1;
}
.plugin-detail-info {
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg-elevated, #222);
  margin-bottom: 12px;
}
.plugin-detail-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.plugin-detail-name {
  font-weight: 600;
  font-size: 16px;
  line-height: 1.4;
}
.plugin-detail-author {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted, #888);
}
.plugin-detail-desc {
  margin: 8px 0 12px;
  font-size: 13px;
  color: var(--text-secondary, #aaa);
  line-height: 1.5;
}
.plugin-detail-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.plugin-detail-readme {
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg-elevated, #222);
}
.plugin-readme-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #888);
  padding: 8px 0;
}
.plugin-readme-empty {
  font-size: 12px;
  color: var(--text-muted, #888);
  padding: 8px 0;
}
.plugin-readme-body {
  font-size: 13px;
  color: var(--text-primary, #ddd);
  line-height: 1.6;
  max-height: 500px;
  overflow-y: auto;
}
.plugin-readme-body :deep(h1),
.plugin-readme-body :deep(h2),
.plugin-readme-body :deep(h3) {
  color: var(--text-primary, #ddd);
  margin: 16px 0 8px;
  font-weight: 600;
}
.plugin-readme-body :deep(h1) { font-size: 18px; }
.plugin-readme-body :deep(h2) { font-size: 16px; }
.plugin-readme-body :deep(h3) { font-size: 14px; }
.plugin-readme-body :deep(p) {
  margin: 8px 0;
}
.plugin-readme-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
  margin: 8px 0;
}
.plugin-readme-body :deep(code) {
  background: var(--bg-input, #2a2a2c);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
}
.plugin-readme-body :deep(pre) {
  background: var(--bg-input, #2a2a2c);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.plugin-readme-body :deep(pre code) {
  background: none;
  padding: 0;
}
.plugin-readme-body :deep(ul),
.plugin-readme-body :deep(ol) {
  padding-left: 20px;
  margin: 8px 0;
}
.plugin-readme-body :deep(a) {
  color: var(--accent, #8A8A8A);
  text-decoration: none;
}
.plugin-readme-body :deep(a:hover) {
  text-decoration: underline;
}
.plugin-readme-body :deep(blockquote) {
  border-left: 3px solid var(--border, #333);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-muted, #888);
}
.plugin-readme-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}
.plugin-readme-body :deep(th),
.plugin-readme-body :deep(td) {
  border: 1px solid var(--border, #333);
  padding: 6px 10px;
  font-size: 12px;
  text-align: left;
}
.plugin-readme-body :deep(th) {
  background: var(--bg-input, #2a2a2c);
  font-weight: 600;
}
</style>
