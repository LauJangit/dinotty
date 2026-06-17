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
        <div v-if="accessUrl" class="qr-code-wrap">
          <canvas ref="qrCanvasRef"></canvas>
        </div>
        <p class="settings-hint">{{ t('settings.accessUrlHint') }}</p>
      </div>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.token') }}</h3>
      <div class="token-row">
        <input
          ref="tokenInputRef"
          :type="tokenVisible ? 'text' : 'password'"
          :value="tokenEditing ? customToken : currentToken"
          :readonly="!tokenEditing"
          class="token-input"
          :placeholder="tokenEditing ? t('settings.token.custom') : ''"
          @input="customToken = ($event.target as HTMLInputElement).value"
        />
        <button class="icon-btn" @click="tokenVisible = !tokenVisible" :title="tokenVisible ? t('settings.token.hide') : t('settings.token.show')"><EyeOff v-if="tokenVisible" :size="14" /><Eye v-else :size="14" /></button>
        <template v-if="!tokenEditing">
          <button class="icon-btn" @click="copyToken" :title="t('settings.token.copy')"><Check v-if="tokenCopied" :size="14" /><Copy v-else :size="14" /></button>
          <button class="icon-btn" @click="startEditToken" :title="t('settings.token.edit')"><Pencil :size="14" /></button>
          <button class="icon-btn danger" @click="regenerateToken" :title="t('settings.token.regenerate')"><RefreshCw :size="14" /></button>
        </template>
        <template v-else>
          <button class="icon-btn" @click="saveToken" :disabled="customToken.trim().length < 8 || tokenSaving" :title="t('settings.token.save')"><Save :size="14" /></button>
          <button class="icon-btn" @click="cancelEditToken" :title="t('settings.token.cancel')"><X :size="14" /></button>
        </template>
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

    <section class="settings-section">
      <h3>{{ t('settings.behavior') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.confirmBeforeCloseTab') }}</label>
        <label class="toggle">
          <input
            type="checkbox"
            v-model="settings.confirm_before_close_tab"
            data-setting="confirm-before-close-tab"
          />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <p class="settings-hint" data-hint="confirm-before-close-tab">
        {{ t('settings.confirmBeforeCloseTabHint') }}
      </p>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import QRCode from 'qrcode'
import { Eye, EyeOff, Copy, Check, Pencil, RefreshCw, Save, X } from 'lucide-vue-next'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { themes } from '../../themes'
import { copyToClipboard } from '../../utils/clipboard'
import { apiUrl, authFetch, getAuthToken, setAuthToken, getApiBase, fetchServerToken } from '../../composables/apiBase'

const { settings, applyCurrentTheme } = useSettings()
const { t, themeLabel } = useI18n()

function selectTheme() {
  applyCurrentTheme()
}

const accessUrl = ref('')
const copied = ref(false)
const qrCanvasRef = ref<HTMLCanvasElement | null>(null)
const currentToken = ref('')

watch([accessUrl, qrCanvasRef, currentToken], ([url, canvas, token]) => {
  if (url && canvas) {
    const qrUrl = token ? `${url}/?token=${token}` : url
    QRCode.toCanvas(canvas, qrUrl, {
      width: 160,
      margin: 2,
      color: { dark: '#C7C7C7', light: '#00000000' },
    })
  }
})

onMounted(async () => {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/info'))
    const info = await res.json()
    accessUrl.value = `http://${info.lan_ip}:${info.port}`
  } catch {
    const { hostname } = window.location
    const host = hostname === 'localhost' ? '127.0.0.1' : hostname
    const port = window.location.port
    accessUrl.value = `http://${host}${port ? ':' + port : ''}`
  }
  currentToken.value = await fetchServerToken() || getAuthToken()
})

async function copyAccessUrl() {
  await copyToClipboard(accessUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

// Token management
const tokenVisible = ref(false)
const tokenCopied = ref(false)
const customToken = ref('')
const tokenSaving = ref(false)
const tokenError = ref('')
const tokenEditing = ref(false)
const tokenInputRef = ref<HTMLInputElement | null>(null)

async function copyToken() {
  await copyToClipboard(currentToken.value)
  tokenCopied.value = true
  setTimeout(() => { tokenCopied.value = false }, 2000)
}

function startEditToken() {
  customToken.value = ''
  tokenEditing.value = true
  tokenError.value = ''
  nextTick(() => tokenInputRef.value?.focus())
}

function cancelEditToken() {
  customToken.value = ''
  tokenEditing.value = false
  tokenError.value = ''
}

async function saveToken() {
  const val = customToken.value.trim()
  if (val.length < 8) return
  await applyNewToken(val)
  tokenEditing.value = false
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
      setAuthToken(token)
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

.qr-code-wrap {
  display: flex;
  justify-content: flex-start;
  margin: 12px 0 8px;
}

.qr-code-wrap canvas {
  border-radius: 8px;
  background: var(--bg-input, #1A1A1A);
  border: 1px solid var(--border, #333);
  padding: 8px;
}
</style>
