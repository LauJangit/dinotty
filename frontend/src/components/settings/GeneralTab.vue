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
      <h3>{{ t('settings.panelPosition') }}</h3>
      <div class="settings-row">
        <select v-model="settings.panel_position" class="shortcut-input" style="flex:1">
          <option value="auto">{{ t('settings.panelPos.auto') }}</option>
          <option value="left">{{ t('settings.panelPos.left') }}</option>
          <option value="right">{{ t('settings.panelPos.right') }}</option>
          <option value="top">{{ t('settings.panelPos.top') }}</option>
          <option value="bottom">{{ t('settings.panelPos.bottom') }}</option>
        </select>
      </div>
      <p class="settings-hint">{{ t('settings.panelPositionHint') }}</p>
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
      <h3>{{ t('settings.token') }}</h3>
      <div class="token-row">
        <input
          :type="tokenVisible ? 'text' : 'password'"
          :value="currentToken"
          readonly
          class="token-input"
        />
        <button class="icon-btn" @click="tokenVisible = !tokenVisible">{{ tokenVisible ? t('settings.token.hide') : t('settings.token.show') }}</button>
        <button class="icon-btn" @click="copyToken">{{ tokenCopied ? '✓' : t('settings.token.copy') }}</button>
      </div>
      <div class="token-row" style="margin-top:8px">
        <input
          v-model="customToken"
          type="text"
          class="token-input"
          :placeholder="t('settings.token.custom')"
        />
        <button class="icon-btn" @click="saveToken" :disabled="customToken.trim().length < 8 || tokenSaving">{{ t('settings.token.save') }}</button>
        <button class="icon-btn danger" @click="regenerateToken">{{ t('settings.token.regenerate') }}</button>
      </div>
      <p class="settings-hint">{{ t('settings.token.hint') }}</p>
      <p v-if="tokenError" class="token-error">{{ tokenError }}</p>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.ipWhitelist') }}</h3>
      <div v-for="(ip, idx) in settings.ip_whitelist" :key="idx" class="ip-row">
        <span class="ip-text">{{ ip }}</span>
        <button class="icon-btn danger" @click="removeIp(idx)">✕</button>
      </div>
      <div class="ip-row" style="margin-top:8px">
        <input
          v-model="newIp"
          type="text"
          class="token-input"
          :placeholder="t('settings.ipWhitelist.placeholder')"
          @keydown.enter="addIp"
        />
        <button class="icon-btn" @click="addIp">{{ t('settings.ipWhitelist.add') }}</button>
      </div>
      <p class="settings-hint">{{ t('settings.ipWhitelist.hint') }}</p>
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

    <section class="settings-section">
      <h3>{{ t('settings.virtualKeyboard') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.virtualKeyboard.show') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.show_virtual_keyboard" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <p class="settings-hint">{{ t('settings.virtualKeyboard.hint') }}</p>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { themes } from '../../themes'
import { copyToClipboard } from '../../utils/clipboard'
import { apiUrl, authFetch, getAuthToken, clearAuthToken } from '../../composables/apiBase'

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
  currentToken.value = getAuthToken()
})

async function copyAccessUrl() {
  await copyToClipboard(accessUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

// Token management
const currentToken = ref('')
const tokenVisible = ref(false)
const tokenCopied = ref(false)
const customToken = ref('')
const tokenSaving = ref(false)
const tokenError = ref('')

async function copyToken() {
  await copyToClipboard(currentToken.value)
  tokenCopied.value = true
  setTimeout(() => { tokenCopied.value = false }, 2000)
}

async function saveToken() {
  const val = customToken.value.trim()
  if (val.length < 8) return
  await applyNewToken(val)
  customToken.value = ''
}

async function regenerateToken() {
  if (!confirm(t('settings.token.confirmRegenerate'))) return
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  const token = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
  await applyNewToken(token)
}

async function applyNewToken(token: string) {
  tokenSaving.value = true
  tokenError.value = ''
  try {
    const res = await authFetch(apiUrl('/api/token'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.ok) {
      clearAuthToken()
      window.location.reload()
    } else {
      tokenError.value = t('settings.token.saveFailed')
    }
  } catch {
    tokenError.value = t('settings.token.saveFailed')
  } finally {
    tokenSaving.value = false
  }
}

// IP whitelist
const newIp = ref('')

function addIp() {
  const val = newIp.value.trim()
  if (!val) return
  if (!settings.ip_whitelist.includes(val)) {
    settings.ip_whitelist.push(val)
  }
  newIp.value = ''
}

function removeIp(idx: number) {
  settings.ip_whitelist.splice(idx, 1)
}
</script>

<style scoped>
.token-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.token-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #3C3C3C;
  border-radius: 5px;
  background: #2A2A2C;
  color: #E8E8E8;
  font-size: 13px;
  font-family: monospace;
  outline: none;
  min-width: 0;
}

.token-input:focus {
  border-color: #007AFF;
}

.icon-btn {
  padding: 6px 10px;
  border: 1px solid #3C3C3C;
  border-radius: 5px;
  background: #2A2A2C;
  color: #C8C8C8;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.icon-btn:hover {
  background: #3A3A3C;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn.danger {
  color: #F44747;
  border-color: #4a2020;
}

.icon-btn.danger:hover {
  background: #3a1e1e;
}

.ip-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}

.ip-text {
  flex: 1;
  font-size: 13px;
  color: #C8C8C8;
  font-family: monospace;
  padding: 4px 2px;
}

.token-error {
  color: #F44747;
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
