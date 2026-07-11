<template>
  <div>
    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.about.title') }}</h3>
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
        <a
          href="https://github.com/xichan96/dinotty"
          target="_blank"
          rel="noopener"
          class="about-link"
        >
          https://github.com/xichan96/dinotty
        </a>
      </div>
    </div>
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
}>({
  version: '',
  repo_url: '',
})

async function loadInfo() {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/info'))
    const data = await res.json()
    info.value = {
      version: data.version || '',
      repo_url: data.repo_url || '',
    }
  } catch {
    // ignore
  }
}

onMounted(loadInfo)
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
  color: var(--fg-bright, #f0f6fc);
}
.about-val {
  font-size: 13px;
  color: var(--fg-muted, #666);
}
.about-link {
  font-size: 13px;
  color: var(--accent, #8a8a8a);
  text-decoration: none;
  word-break: break-all;
}
.about-link:hover {
  text-decoration: underline;
}
</style>
