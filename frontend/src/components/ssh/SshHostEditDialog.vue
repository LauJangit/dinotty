<template>
  <Teleport to="body">
    <div class="ssh-edit-backdrop" @click.self="$emit('close')">
      <div class="ssh-edit-panel">
        <div class="ssh-edit-header">
          <h2>{{ profile ? t('ssh.edit') : t('ssh.newHost') }}</h2>
          <button class="ssh-edit-close" @click="$emit('close')">&times;</button>
        </div>

        <div class="ssh-edit-body">
          <div class="ssh-field">
            <label>{{ t('ssh.name') }}</label>
            <input v-model="form.name" :placeholder="form.host || 'My Server'" class="ssh-edit-input" />
          </div>

          <div class="ssh-field-row">
            <div class="ssh-field ssh-field-host">
              <label>{{ t('ssh.host') }} *</label>
              <input v-model="form.host" placeholder="192.168.1.100" class="ssh-edit-input" />
            </div>
            <div class="ssh-field ssh-field-port">
              <label>{{ t('ssh.port') }}</label>
              <input v-model.number="form.port" type="number" class="ssh-edit-input" />
            </div>
          </div>

          <div class="ssh-field">
            <label>{{ t('ssh.username') }} *</label>
            <input v-model="form.username" placeholder="root" class="ssh-edit-input" />
          </div>

          <div class="ssh-field">
            <label>{{ t('ssh.group') }}</label>
            <input v-model="form.group" placeholder="Production" class="ssh-edit-input" />
          </div>

          <div class="ssh-field">
            <label>{{ t('ssh.authType') }}</label>
            <div class="ssh-radio-group">
              <label class="ssh-radio">
                <input type="radio" v-model="authType" value="password" />
                <span>{{ t('ssh.authPassword') }}</span>
              </label>
              <label class="ssh-radio">
                <input type="radio" v-model="authType" value="key_file" />
                <span>{{ t('ssh.authKeyFile') }}</span>
              </label>
              <label class="ssh-radio">
                <input type="radio" v-model="authType" value="key_inline" />
                <span>{{ t('ssh.authKeyInline') }}</span>
              </label>
            </div>
          </div>

          <div v-if="authType === 'password'" class="ssh-field">
            <label>{{ t('ssh.password') }}</label>
            <input v-model="password" type="password" class="ssh-edit-input" />
          </div>

          <div v-if="authType === 'key_file'" class="ssh-field">
            <label>{{ t('ssh.keyPath') }}</label>
            <input v-model="keyPath" placeholder="~/.ssh/id_rsa" class="ssh-edit-input" />
          </div>

          <div v-if="authType === 'key_inline'" class="ssh-field">
            <label>{{ t('ssh.privateKey') }}</label>
            <textarea v-model="privateKey" class="ssh-edit-textarea" rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
          </div>

          <div v-if="authType !== 'password'" class="ssh-field">
            <label>{{ t('ssh.passphrase') }}</label>
            <input v-model="passphrase" type="password" class="ssh-edit-input" />
          </div>

          <div class="ssh-field">
            <label>{{ t('ssh.defaultCommand') }}</label>
            <input v-model="form.default_command" placeholder="bash" class="ssh-edit-input" />
          </div>
        </div>

        <div class="ssh-edit-footer">
          <button class="ssh-edit-cancel" @click="$emit('close')">{{ t('ssh.cancel') }}</button>
          <button class="ssh-edit-save" @click="onSave" :disabled="!isValid">
            {{ t('ssh.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { SshProfile, SshAuthMethod } from '../../composables/useSettings'

const { t } = useI18n()

const props = defineProps<{
  profile: SshProfile | null
}>()

const emit = defineEmits<{
  save: [profile: SshProfile]
  close: []
}>()

const authType = ref<'password' | 'key_file' | 'key_inline'>('password')
const password = ref('')
const keyPath = ref('')
const privateKey = ref('')
const passphrase = ref('')

const form = reactive({
  name: '',
  host: '',
  port: 22,
  username: 'root',
  group: '',
  default_command: '',
})

// Initialize from profile
if (props.profile) {
  form.name = props.profile.name
  form.host = props.profile.host
  form.port = props.profile.port
  form.username = props.profile.username
  form.group = props.profile.group || ''
  form.default_command = props.profile.default_command || ''

  authType.value = props.profile.auth_method.type
  if (props.profile.auth_method.type === 'password') {
    password.value = props.profile.auth_method.password || ''
  } else if (props.profile.auth_method.type === 'key_file') {
    keyPath.value = props.profile.auth_method.key_path || ''
    passphrase.value = props.profile.auth_method.passphrase || ''
  } else if (props.profile.auth_method.type === 'key_inline') {
    privateKey.value = props.profile.auth_method.private_key || ''
    passphrase.value = props.profile.auth_method.passphrase || ''
  }
}

const isValid = computed(() => {
  if (!form.host.trim()) return false
  if (!form.username.trim()) return false
  if (authType.value === 'password' && !password.value) return false
  if (authType.value === 'key_file' && !keyPath.value.trim()) return false
  if (authType.value === 'key_inline' && !privateKey.value.trim()) return false
  return true
})

function buildAuthMethod(): SshAuthMethod {
  if (authType.value === 'password') {
    return { type: 'password', password: password.value }
  } else if (authType.value === 'key_file') {
    return { type: 'key_file', key_path: keyPath.value.trim(), passphrase: passphrase.value || null }
  } else {
    return { type: 'key_inline', private_key: privateKey.value, passphrase: passphrase.value || null }
  }
}

function onSave() {
  if (!isValid.value) return

  const profile: SshProfile = {
    id: props.profile?.id || crypto.randomUUID(),
    name: form.name.trim() || form.host.trim(),
    host: form.host.trim(),
    port: form.port || 22,
    username: form.username.trim() || 'root',
    auth_method: buildAuthMethod(),
    group: form.group.trim() || null,
    default_command: form.default_command.trim() || null,
  }

  emit('save', profile)
}
</script>

<style scoped>
.ssh-edit-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 960;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px) 0;
}

.ssh-edit-panel {
  width: 90vw;
  max-width: 440px;
  max-height: 85vh;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ssh-edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.ssh-edit-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-bright);
  margin: 0;
}
.ssh-edit-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  font-size: 18px;
}

.ssh-edit-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ssh-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ssh-field label {
  font-size: 12px;
  color: var(--fg-muted);
  font-weight: 500;
}

.ssh-field-row {
  display: flex;
  gap: 8px;
}
.ssh-field-host { flex: 1; }
.ssh-field-port { width: 80px; }

.ssh-edit-input {
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
.ssh-edit-input:focus {
  border-color: var(--accent, #4d7fff);
}

.ssh-edit-textarea {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}
.ssh-edit-textarea:focus {
  border-color: var(--accent, #4d7fff);
}

.ssh-radio-group {
  display: flex;
  gap: 16px;
}
.ssh-radio {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
}
.ssh-radio input {
  accent-color: var(--accent, #4d7fff);
}

.ssh-edit-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}

.ssh-edit-cancel {
  padding: 8px 16px;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 13px;
  border: 1px solid var(--border);
}
.ssh-edit-cancel:hover {
  background: var(--bg-hover);
}

.ssh-edit-save {
  padding: 8px 16px;
  border-radius: 4px;
  background: var(--accent, #4d7fff);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}
.ssh-edit-save:disabled {
  opacity: 0.5;
}
.ssh-edit-save:not(:disabled):hover {
  opacity: 0.9;
}
</style>
