<template>
  <Teleport to="body">
    <div v-if="visible" class="cw-backdrop" @click.self="$emit('close')">
      <div class="cw-modal">
        <div class="cw-header">
          <span class="cw-title">{{ isEdit ? t('palette.rename') : t('workspace.add') }}</span>
          <button class="cw-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="cw-body">
          <label class="cw-label">{{ t('workspace.path') }}</label>
          <div class="cw-path-row">
            <input
              ref="pathInput"
              v-model="path"
              class="cw-input"
              :disabled="isEdit"
              placeholder="/Users/me/projects/my-app"
              @keydown.enter="onSubmit"
            />
            <button v-if="!isEdit" class="cw-browse-btn" @click="toggleBrowser">
              <FolderOpen :size="14" />
            </button>
          </div>

          <label class="cw-label">{{ t('workspace.name') }} <span class="cw-optional">({{ t('workspace.path').toLowerCase() }})</span></label>
          <input
            v-model="name"
            class="cw-input"
            :placeholder="t('workspace.name')"
            @keydown.enter="onSubmit"
          />
          <p v-if="error" class="cw-error">{{ error }}</p>
        </div>
        <div class="cw-footer">
          <button class="cw-btn cancel" @click="$emit('close')">{{ t('confirm.closeWindowCancel') }}</button>
          <button class="cw-btn primary" :disabled="!canSubmit" @click="onSubmit">
            {{ isEdit ? t('settings.token.save') : t('workspace.add') }}
          </button>
        </div>
      </div>
    </div>

    <FilePickerModal
      v-if="!isEdit"
      :visible="showPicker"
      pane-id=""
      root="~"
      @update:visible="showPicker = $event"
      @select="onPickerSelect"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useWorkspaces } from '../../composables/useWorkspaces'
import type { Workspace } from '../../types/workspace'
import FilePickerModal from '../preview/FilePickerModal.vue'

const { t } = useI18n()
const { createWorkspace, updateWorkspace } = useWorkspaces()

const props = defineProps<{
  visible: boolean
  workspace?: Workspace | null
}>()

const emit = defineEmits<{
  close: []
  created: [id: string]
}>()

const isEdit = computed(() => !!props.workspace)

const path = ref('')
const name = ref('')
const error = ref('')
const pathInput = ref<HTMLInputElement | null>(null)
const showPicker = ref(false)

const canSubmit = computed(() => {
  if (isEdit.value) return !!name.value.trim()
  return !!path.value.trim()
})

watch(() => props.visible, (v) => {
  if (v) {
    if (props.workspace) {
      path.value = props.workspace.path
      name.value = props.workspace.name
    } else {
      path.value = ''
      name.value = ''
    }
    error.value = ''
    nextTick(() => pathInput.value?.focus())
  }
})

function toggleBrowser() {
  showPicker.value = true
}

function onPickerSelect(selected: string) {
  path.value = selected
  showPicker.value = false
  autoFillName()
}

function autoFillName() {
  if (!name.value.trim()) {
    const p = path.value.trim()
    if (p) {
      const parts = p.split('/').filter(Boolean)
      name.value = parts[parts.length - 1] || ''
    }
  }
}

watch(path, () => {
  if (!name.value.trim()) {
    autoFillName()
  }
})

async function onSubmit() {
  if (!canSubmit.value) return
  error.value = ''
  try {
    if (isEdit.value && props.workspace) {
      await updateWorkspace(props.workspace.id, { name: name.value.trim() })
    } else {
      const p = path.value.trim()
      autoFillName()
      const ws = await createWorkspace(p, name.value.trim() || undefined)
      emit('created', ws.id)
    }
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Failed'
  }
}
</script>

<style scoped>
.cw-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cw-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90vw;
  max-width: 400px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.cw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}
.cw-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}
.cw-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--fg-muted);
  background: none;
  border: none;
  cursor: pointer;
}
.cw-close:hover {
  background: rgba(255, 255, 255, 0.08);
}
.cw-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cw-label {
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 4px;
}
.cw-optional {
  opacity: 0.6;
  font-size: 11px;
}
.cw-path-row {
  display: flex;
  gap: 6px;
}
.cw-input {
  background: var(--bg-input, #2a2a2a);
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.cw-input:focus {
  border-color: var(--accent);
}
.cw-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cw-browse-btn {
  flex-shrink: 0;
  padding: 8px 10px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--bg-input, #2a2a2a);
  color: var(--fg-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.cw-browse-btn:hover {
  border-color: var(--accent);
  color: var(--fg);
}
.cw-error {
  font-size: 12px;
  color: var(--color-red, #ef4444);
  margin: 2px 0 0;
}
.cw-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}
.cw-btn {
  padding: 6px 16px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  color: var(--fg-muted);
  background: none;
}
.cw-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg);
}
.cw-btn.primary {
  background: var(--accent);
  color: #fff;
}
.cw-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cw-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>
