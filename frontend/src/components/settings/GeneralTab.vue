<template>
  <div>
    <section class="settings-section">
      <h3>{{ t('settings.language') }}</h3>
      <div class="settings-row">
        <select v-model="settings.locale" class="shortcut-input" style="flex:1">
          <option value="zh">{{ t('settings.lang.zh') }}</option>
          <option value="en">{{ t('settings.lang.en') }}</option>
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.theme') }}</h3>
      <div class="settings-row">
        <select v-model="settings.theme.preset" class="shortcut-input" style="flex:1" @change="selectTheme">
          <option v-for="th in themes" :key="th.name" :value="th.name">{{ themeLabel(th.name) }}</option>
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.accessUrl') }}</h3>
      <div class="access-url-row">
        <div class="access-url-display">
          <span class="access-url-text">{{ accessUrl }}</span>
          <button class="access-url-copy" @click="copyAccessUrl" :title="t('settings.copyUrl')">
            {{ copied ? '✓' : '⧉' }}
          </button>
        </div>
        <p class="settings-hint">{{ t('settings.accessUrlHint') }}</p>
      </div>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.monitor') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.monitor.enabled') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.enabled" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { themes } from '../../themes'
import { copyToClipboard } from '../../utils/clipboard'
import { apiUrl, authFetch } from '../../composables/apiBase'

const { settings, applyCurrentTheme } = useSettings()
const { t, themeLabel } = useI18n()

function selectTheme() {
  applyCurrentTheme()
}

const accessUrl = ref('')
const copied = ref(false)

onMounted(async () => {
  try {
    const res = await authFetch(apiUrl('/api/info'))
    const info = await res.json()
    accessUrl.value = `http://${info.lan_ip}:${info.port}`
  } catch {
    const { hostname } = window.location
    const host = hostname === 'localhost' ? '127.0.0.1' : hostname
    const port = window.location.port
    accessUrl.value = `http://${host}${port ? ':' + port : ''}`
  }
})

async function copyAccessUrl() {
  await copyToClipboard(accessUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>
