<template>
  <div class="mc-ws-panel">
    <template v-if="workspaces.length === 0 && allCount === 0">
      <div class="mc-ws-empty">
        <p class="mc-ws-empty-text">{{ t('workspace.firstUse') }}</p>
        <button class="mc-ws-add-btn" @click="$emit('add')">
          <Plus :size="14" />
          {{ t('workspace.add') }}
        </button>
      </div>
    </template>
    <template v-else>
      <div class="mc-ws-items">
        <button
          class="mc-ws-item"
          :class="{ selected: selectedId === '__all__' }"
          @click="$emit('selectAll')"
        >
          <span class="mc-ws-dot">★</span>
          <div class="mc-ws-info">
            <span class="mc-ws-name">{{ t('workspace.all') }}</span>
            <span class="mc-ws-path">~/</span>
          </div>
          <span v-if="allCount" class="mc-ws-count">{{ allCount }}</span>
        </button>
        <button
          v-for="ws in workspaces"
          :key="ws.id"
          class="mc-ws-item"
          :class="{ selected: ws.id === selectedId, active: ws.id === activeId }"
          @click="$emit('select', ws.id)"
          @contextmenu.prevent="openCtx($event, ws)"
        >
          <div class="mc-ws-info">
            <span class="mc-ws-name">{{ ws.name }}</span>
            <span class="mc-ws-path">{{ ws.path }}</span>
          </div>
          <span v-if="tabCounts[ws.id]" class="mc-ws-count">{{ tabCounts[ws.id] }}</span>
        </button>
      </div>
      <div class="mc-ws-footer">
        <button class="mc-ws-add-btn" @click="$emit('add')">
          <Plus :size="14" />
          {{ t('workspace.add') }}
        </button>
      </div>
    </template>
    <ContextMenu
      :visible="ctxVisible"
      :x="ctxX"
      :y="ctxY"
      :items="ctxItems"
      @close="ctxVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useWorkspaces } from '../../composables/useWorkspaces'
import type { Workspace } from '../../types/workspace'
import ContextMenu from '../ui/ContextMenu.vue'
import type { ContextMenuItem } from '../ui/ContextMenu.vue'

const { t } = useI18n()
const { deleteWorkspace } = useWorkspaces()

const props = defineProps<{
  workspaces: Workspace[]
  selectedId: string | null
  activeId: string | null
  tabCounts: Record<string, number>
  allCount: number
}>()

const emit = defineEmits<{
  select: [id: string | null]
  selectAll: []
  add: []
  rename: [id: string]
}>()

// Context menu
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

function openCtx(e: MouseEvent, ws: Workspace) {
  ctxX.value = e.clientX
  ctxY.value = e.clientY
  ctxItems.value = [
    {
      label: t('palette.rename'),
      icon: Pencil,
      action: () => emit('rename', ws.id),
    },
    {
      label: t('workspace.delete'),
      icon: Trash2,
      danger: true,
      action: async () => {
        if (!confirm(t('workspace.confirmDelete').replace('{name}', ws.name))) return
        try {
          await deleteWorkspace(ws.id)
        } catch (err) {
          console.error('Failed to delete workspace:', err)
        }
      },
    },
  ]
  ctxVisible.value = true
}
</script>
