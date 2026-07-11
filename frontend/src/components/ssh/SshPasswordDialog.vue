<template>
  <Teleport to="body">
    <div class="ssh-pw-backdrop" @click.self="$emit('close')">
      <div class="ssh-pw-panel">
        <div class="ssh-pw-header">
          <h2>{{ t('ssh.connect') }}</h2>
          <button class="ssh-pw-close" @click="$emit('close')">&times;</button>
        </div>

        <div class="ssh-pw-body">
          <div class="ssh-pw-target">{{ username }}@{{ host }}:{{ port }}</div>

          <div class="ssh-pw-field">
            <label>{{ t('ssh.password') }}</label>
            <input
              ref="pwInput"
              v-model="password"
              type="password"
              class="ssh-pw-input"
              autofocus
              @keydown.enter="onConnect"
              @keydown.escape="$emit('close')"
            />
          </div>

          <div v-if="error" class="ssh-pw-error">{{ error }}</div>
        </div>

        <div class="ssh-pw-footer">
          <button class="ssh-pw-cancel" @click="$emit('close')">{{ t('ssh.cancel') }}</button>
          <button class="ssh-pw-connect" @click="onConnect" :disabled="connecting">
            {{ connecting ? t('ssh.connecting') : t('ssh.connect') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  host: string
  port: number
  username: string
  name?: string
}>()

const emit = defineEmits<{
  connect: [password: string]
  close: []
}>()

const password = ref('')
const error = ref('')
const connecting = ref(false)
const pwInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  nextTick(() => pwInput.value?.focus())
})

function onConnect() {
  if (connecting.value) return
  if (!password.value) {
    error.value = t('ssh.errorPassword')
    return
  }
  connecting.value = true
  error.value = ''
  emit('connect', password.value)
}
</script>

<style scoped>
.ssh-pw-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 960;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ssh-pw-panel {
  width: 90vw;
  max-width: 380px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ssh-pw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.ssh-pw-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-bright);
  margin: 0;
}
.ssh-pw-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  font-size: 18px;
}

.ssh-pw-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ssh-pw-target {
  font-size: 13px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.ssh-pw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ssh-pw-field label {
  font-size: 12px;
  color: var(--fg-muted);
  font-weight: 500;
}
.ssh-pw-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.ssh-pw-input:focus {
  border-color: var(--accent, #4d7fff);
}

.ssh-pw-error {
  color: #e55;
  font-size: 12px;
}

.ssh-pw-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.ssh-pw-cancel {
  padding: 8px 16px;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 13px;
  border: 1px solid var(--border);
}
.ssh-pw-cancel:hover {
  background: var(--bg-hover);
}

.ssh-pw-connect {
  padding: 8px 16px;
  border-radius: 4px;
  background: var(--accent, #4d7fff);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}
.ssh-pw-connect:disabled {
  opacity: 0.5;
}
.ssh-pw-connect:not(:disabled):hover {
  opacity: 0.9;
}
</style>
