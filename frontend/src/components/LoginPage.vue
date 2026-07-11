<template>
  <div class="login-screen">
    <div class="login-card">
      <img src="/logo.png" alt="Dinotty" class="login-logo" />
      <h1 class="login-title">Dinotty</h1>
      <p class="login-subtitle">{{ t('login.subtitle') }}</p>
      <form @submit.prevent="onSubmit">
        <input
          v-model="token"
          type="password"
          class="login-input"
          :placeholder="t('login.placeholder')"
          autocomplete="current-password"
          autofocus
          :disabled="retryIn > 0"
          @focus="error = ''"
        />
        <button type="submit" class="login-btn" :disabled="loading || retryIn > 0">
          {{ loading ? t('login.loading') : t('login.submit') }}
        </button>
      </form>
      <p v-if="error" class="login-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { validateToken } from '../composables/apiBase'
import { useI18n } from '../composables/useI18n'

const emit = defineEmits<{ (e: 'success'): void }>()
const { t } = useI18n()

const token = ref('')
const error = ref('')
const loading = ref(false)
const retryIn = ref(0)
let lockdownTimer: number | undefined

function clearLockdown() {
  if (lockdownTimer !== undefined) {
    window.clearInterval(lockdownTimer)
    lockdownTimer = undefined
  }
  retryIn.value = 0
}

function startLockdown(seconds: number) {
  clearLockdown()
  retryIn.value = seconds
  error.value = t('login.locked', { seconds })
  lockdownTimer = window.setInterval(() => {
    retryIn.value -= 1
    if (retryIn.value <= 0) {
      clearLockdown()
      error.value = ''
      return
    }
    error.value = t('login.locked', { seconds: retryIn.value })
  }, 1000)
}

async function onSubmit() {
  const val = token.value.trim()
  if (!val) {
    error.value = t('login.empty')
    return
  }
  loading.value = true
  error.value = ''
  const r = await validateToken(val)
  loading.value = false
  if (r.ok) {
    emit('success')
    return
  }
  if (r.reason === 'locked') {
    startLockdown(r.retryAfter ?? 60)
  } else {
    error.value = t('login.invalid')
  }
}

onBeforeUnmount(clearLockdown)
</script>

<style scoped>
.login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100dvh;
  background: var(--bg);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 340px;
  padding: 32px 24px;
}

.login-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

.login-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--fg-bright);
  margin: 0;
  font-family:
    'Inter',
    system-ui,
    -apple-system,
    sans-serif;
}

.login-subtitle {
  font-size: 13px;
  color: var(--fg-muted);
  margin: 0;
  text-align: center;
}

.login-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg-bright);
  font-size: 14px;
  font-family: 'Inter', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s;
  margin-top: 8px;
}
.login-input:focus {
  border-color: var(--accent);
}
.login-input::placeholder {
  color: var(--fg-muted);
}

.login-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Inter', system-ui, sans-serif;
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.15s;
}
.login-btn:hover {
  background: var(--accent-hover);
}
.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-error {
  color: #f44747;
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
