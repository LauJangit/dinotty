<template>
  <div>
    <section class="settings-section">
      <h3>{{ t('settings.plugins.install') }}</h3>
      <div class="settings-row">
        <label class="plugin-install-btn">
          <input type="file" accept=".tar.gz,.tgz" hidden @change="onInstallFile" />
          <span>{{ t('settings.plugins.installFile') }}</span>
        </label>
      </div>
      <div v-if="installError" class="plugin-error-msg">{{ installError }}</div>
      <div v-if="installSuccess" class="plugin-success-msg">{{ installSuccess }}</div>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.plugins.devLink') }}</h3>
      <div class="settings-row">
        <input
          v-model="devPath"
          class="shortcut-input"
          style="flex: 1"
          placeholder="/path/to/my-plugin"
        />
        <button class="plugin-action-btn" @click="onDevLink" :disabled="!devPath.trim()">
          {{ t('settings.plugins.load') }}
        </button>
      </div>
      <p class="settings-hint">{{ t('settings.plugins.devLinkHint') }}</p>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.plugins.installed') }} ({{ settingsPlugins.length }})</h3>
      <div v-if="settingsPlugins.length === 0" class="plugin-empty">
        {{ t('settings.plugins.none') }}
      </div>
      <div v-for="p in settingsPlugins" :key="p.id" class="plugin-card">
        <div class="plugin-card-header">
          <span class="plugin-card-name">{{ p.name }}</span>
          <span v-if="p.state === 'error'" class="plugin-card-state plugin-card-error">error</span>
          <span class="plugin-card-version">v{{ p.version }}</span>
        </div>
        <p v-if="p.description" class="plugin-card-desc">{{ p.description }}</p>
        <div class="plugin-card-actions">
          <label class="plugin-action-btn">
            <input type="file" accept=".tar.gz,.tgz" hidden @change="onUpdateFile($event, p.id)" />
            <span>{{ t('settings.plugins.update') }}</span>
          </label>
          <button class="plugin-action-btn plugin-danger" @click="onUninstall(p.id)">
            {{ t('settings.plugins.uninstall') }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { authFetch, apiUrl } from '../../composables/apiBase'
import { usePluginLoader } from '../../composables/usePluginLoader'

const { t } = useI18n()
const { loadedPlugins, loadAll, unloadPlugin } = usePluginLoader()

const settingsPlugins = computed(() =>
  Array.from(loadedPlugins.values()).map(p => ({
    id: p.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    state: p.state,
  })),
)

const installError = ref('')
const installSuccess = ref('')
const devPath = ref('')

async function onInstallFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  installError.value = ''
  installSuccess.value = ''

  const form = new FormData()
  form.append('file', file)
  const res = await authFetch(apiUrl('/api/plugins/install'), { method: 'POST', body: form })
  if (res.ok) {
    const manifest = await res.json()
    installSuccess.value = `Installed ${manifest.name} v${manifest.version}`
    await loadAll()
  } else {
    const err = await res.json().catch(() => ({ error: 'Install failed' }))
    installError.value = err.error || 'Install failed'
  }
  input.value = ''
}

async function onUpdateFile(e: Event, id: string) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  installError.value = ''
  installSuccess.value = ''

  const form = new FormData()
  form.append('file', file)
  const res = await authFetch(apiUrl(`/api/plugins/${id}/update`), { method: 'POST', body: form })
  if (res.ok) {
    const manifest = await res.json()
    installSuccess.value = `Updated ${manifest.name} to v${manifest.version}`
    await unloadPlugin(id)
    await loadAll()
  } else {
    const err = await res.json().catch(() => ({ error: 'Update failed' }))
    installError.value = err.error || 'Update failed'
  }
  input.value = ''
}

async function onUninstall(id: string) {
  if (!confirm(`Uninstall plugin "${id}"?`)) return
  await unloadPlugin(id)
  const res = await authFetch(apiUrl(`/api/plugins/${id}`), { method: 'DELETE' })
  if (res.ok) {
    installSuccess.value = `Uninstalled ${id}`
  }
}

async function onDevLink() {
  const path = devPath.value.trim()
  if (!path) return
  installError.value = ''
  installSuccess.value = ''

  const res = await authFetch(apiUrl('/api/plugins/dev-link'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (res.ok) {
    const manifest = await res.json()
    installSuccess.value = `Linked ${manifest.name} from ${path}`
    devPath.value = ''
    await loadAll()
  } else {
    const err = await res.json().catch(() => ({ error: 'Dev-link failed' }))
    installError.value = err.error || 'Dev-link failed'
  }
}
</script>

<style scoped>
.plugin-install-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 6px;
  background: var(--accent, #4d7fff);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  border: none;
}
.plugin-install-btn:hover {
  opacity: 0.9;
}
.plugin-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--bg-hover, #2a2a2a);
  color: var(--text-primary, #ddd);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border, #444);
}
.plugin-action-btn:hover {
  background: var(--bg-surface-hover, #333);
}
.plugin-danger {
  color: var(--color-red, #ef4444);
  border-color: var(--color-red, #ef4444);
}
.plugin-danger:hover {
  background: rgba(239,68,68,0.1);
}
.plugin-error-msg {
  margin-top: 8px;
  color: var(--color-red, #ef4444);
  font-size: 13px;
}
.plugin-success-msg {
  margin-top: 8px;
  color: var(--color-green, #34d399);
  font-size: 13px;
}
.plugin-empty {
  padding: 12px 0;
  color: var(--text-muted, #888);
  font-size: 13px;
}
.plugin-card {
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg-elevated, #222);
}
.plugin-card-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.plugin-card-name {
  font-weight: 600;
  font-size: 14px;
}
.plugin-card-version {
  font-size: 12px;
  color: var(--text-muted, #888);
}
.plugin-card-state {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}
.plugin-card-error {
  color: var(--color-red, #ef4444);
  background: rgba(239, 68, 68, 0.15);
}
.plugin-card-desc {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--text-secondary, #aaa);
}
.plugin-card-actions {
  display: flex;
  gap: 8px;
}
</style>
