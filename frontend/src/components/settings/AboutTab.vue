<template>
  <div>
    <section class="settings-section">
      <h3>{{ t('settings.about.title') }}</h3>
      <div class="about-logo-row">
        <img src="/logo.png" alt="Dinotty" class="about-logo" />
        <span class="about-name">Dinotty</span>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.about.version') }}</label>
        <span class="about-val">{{ info.version || '—' }}</span>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.about.repository') }}</label>
        <a v-if="info.repo_url" :href="info.repo_url" target="_blank" rel="noopener" class="about-link">
          {{ info.repo_url }}
        </a>
        <span v-else class="about-val">—</span>
      </div>
    </section>

    <section class="settings-section" v-if="info.update_available !== undefined">
      <div v-if="info.update_available" class="about-update about-update-available">
        <span class="about-update-text">{{ t('settings.about.updateAvailable') }}: {{ info.latest_version }}</span>
        <a v-if="info.latest_url" :href="info.latest_url" target="_blank" rel="noopener" class="about-update-btn">
          {{ t('settings.about.download') }}
        </a>
      </div>
      <div v-else class="about-update about-update-ok">
        <span class="about-update-text">{{ t('settings.about.upToDate') }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'

const { t } = useI18n()

const info = ref<{
  version: string
  repo_url: string
  update_available?: boolean
  latest_version?: string
  latest_url?: string
}>({
  version: '',
  repo_url: '',
})

onMounted(async () => {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/info'))
    const data = await res.json()
    info.value = {
      version: data.version || '',
      repo_url: data.repo_url || '',
      update_available: data.update_available,
      latest_version: data.latest_version || '',
      latest_url: data.latest_url || '',
    }
  } catch {
    // ignore
  }
})
</script>

<style scoped>
.about-logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.about-logo {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}
.about-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--fg-bright, #F0F6FC);
}
.about-val {
  font-size: 13px;
  color: var(--fg-muted, #666);
}
.about-mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
.about-link {
  font-size: 13px;
  color: var(--accent, #8A8A8A);
  text-decoration: none;
  word-break: break-all;
}
.about-link:hover {
  text-decoration: underline;
}
.about-update {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}
.about-update-ok {
  background: rgba(52, 211, 153, 0.1);
  border: 1px solid rgba(52, 211, 153, 0.25);
  color: #34d399;
}
.about-update-available {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: #f59e0b;
}
.about-update-text {
  font-weight: 500;
}
.about-update-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s;
}
.about-update-btn:hover {
  background: rgba(245, 158, 11, 0.35);
}
</style>
