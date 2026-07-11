<template>
  <Teleport to="body">
    <div class="ssh-auth-backdrop" @click.self="onCancel">
      <div class="ssh-auth-dialog">
        <div class="ssh-auth-header">
          <h3>{{ t('ssh.authRequired') }}</h3>
        </div>
        <div class="ssh-auth-body">
          <p class="ssh-auth-host">{{ host }}</p>
          <div v-for="(p, i) in prompts" :key="i" class="ssh-auth-field">
            <label>{{ p.prompt }}</label>
            <input
              :ref="(el) => { if (el && i === 0) (el as HTMLInputElement).focus() }"
              v-model="responses[i]"
              :type="p.echo ? 'text' : 'password'"
              @keydown.enter="onSubmit"
              @keydown.escape="onCancel"
            />
          </div>
        </div>
        <div class="ssh-auth-footer">
          <button class="ssh-auth-cancel" @click="onCancel">{{ t('ssh.cancel') }}</button>
          <button class="ssh-auth-submit" @click="onSubmit">{{ t('ssh.submit') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  host: string
  prompts: Array<{ prompt: string; echo: boolean }>
}>()

const emit = defineEmits<{
  submit: [responses: string[]]
  cancel: []
}>()

const { t } = useI18n()
const responses = ref<string[]>(props.prompts.map(() => ''))

watch(() => props.prompts, (newPrompts) => {
  responses.value = newPrompts.map(() => '')
}, { immediate: true })

function onSubmit() {
  emit('submit', [...responses.value])
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.ssh-auth-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}
.ssh-auth-dialog {
  background: var(--bg-elevated, #2a2a3e);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  padding: 20px;
  min-width: 340px;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.ssh-auth-header h3 {
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--fg-bright, #f0f0f0);
}
.ssh-auth-host {
  font-size: 12px;
  color: var(--fg-muted);
  margin: 0 0 16px;
  font-family: var(--font-mono);
}
.ssh-auth-field {
  margin-bottom: 12px;
}
.ssh-auth-field label {
  display: block;
  font-size: 12px;
  color: var(--fg-muted, #aaa);
  margin-bottom: 4px;
}
.ssh-auth-field input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border, #555);
  border-radius: 4px;
  background: var(--bg, #1a1a2e);
  color: var(--fg, #ddd);
  font-size: 13px;
  font-family: var(--font-mono);
  box-sizing: border-box;
}
.ssh-auth-field input:focus {
  outline: none;
  border-color: var(--accent, #4d7fff);
}
.ssh-auth-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.ssh-auth-cancel,
.ssh-auth-submit {
  padding: 6px 16px;
  border-radius: 4px;
  border: 1px solid var(--border, #555);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.ssh-auth-cancel {
  background: transparent;
  color: var(--fg);
}
.ssh-auth-cancel:hover {
  background: var(--bg-hover);
}
.ssh-auth-submit {
  background: var(--accent, #4d7fff);
  color: #fff;
  border-color: var(--accent, #4d7fff);
}
.ssh-auth-submit:hover {
  opacity: 0.9;
}
</style>
