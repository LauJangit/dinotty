<template>
  <AnimatePresence>
    <Motion
      v-if="visible"
      key="ws-backdrop"
      ref="backdropRef"
      class="mc-backdrop"
      :class="{ 'mc-closing': closing }"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.2 }"
      tabindex="0"
      @click.self="$emit('close')"
      @keydown="onKeydown"
    >
      <!-- Desktop: dual-panel layout -->
      <Motion
        v-if="!isMobile"
        key="ws-dual"
        class="mc-ws-dual"
        :initial="{ scale: 0.9, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1 }"
        :exit="{ scale: 0.9, opacity: 0 }"
        :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
      >
        <WorkspaceList
          :workspaces="workspaces"
          :selected-id="selectedWorkspaceId"
          :active-id="activeWorkspaceId"
          :tab-counts="tabCounts"
          :all-count="ungroupedCount"
          @select="onSelectWorkspace"
          @select-all="onSelectWorkspace('__all__')"
          @add="onAddWorkspace"
          @rename="onRenameWorkspace"
        />
        <TabOverview
          v-if="filteredCards.length > 0"
          ref="tabOverviewRef"
          :visible="true"
          :cards="filteredCards"
          :active-pane-id="activePaneId"
          :embedded="true"
          @activate="(id: string) => $emit('activate', id)"
          @close-tab="(id: string) => $emit('close-tab', id)"
          @rename-tab="onRenameTab"
        />
        <div v-else class="mc-ws-empty-panel">
          <p class="mc-ws-empty-panel-text">{{ emptyPanelHint }}</p>
          <button class="mc-ws-empty-panel-btn" @click="onNewTabForSelected">
            <Plus :size="16" />
            {{ t('workspace.newTerminal') }}
          </button>
        </div>
      </Motion>

      <!-- Mobile: drilldown -->
      <template v-else>
        <WorkspaceListView
          v-if="drilldownWorkspaceId === undefined"
          key="ws-list-mobile"
          :workspaces="workspaces"
          :active-id="activeWorkspaceId"
          :tab-counts="tabCounts"
          :all-count="ungroupedCount"
          @drilldown="onDrilldown"
          @select-all="onDrilldown('__all__')"
          @add="onAddWorkspace"
          @rename="onRenameWorkspace"
        />
        <WorkspaceTabGrid
          v-else
          key="ws-grid-mobile"
          :workspace="drilldownWorkspace"
          :workspace-id="drilldownWorkspaceId"
          :cards="filteredCards"
          :active-pane-id="activePaneId"
          @back="drilldownWorkspaceId = undefined"
          @activate="(id: string) => $emit('activate', id)"
          @close-tab="(id: string) => $emit('close-tab', id)"
          @new-tab="onNewTab"
          @switch-workspace="onSwitchWorkspace"
          @rename-tab="onRenameTab"
        />
      </template>
    </Motion>
  </AnimatePresence>
  <CreateWorkspaceDialog
    :visible="showCreateDialog || !!renamingWorkspace"
    :workspace="renamingWorkspace"
    @close="showCreateDialog = false; renamingWorkspace = null"
    @created="onWorkspaceCreated"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Motion, AnimatePresence } from 'motion-v'
import { Plus } from 'lucide-vue-next'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { useI18n } from '../../composables/useI18n'
import { useIsMobile } from '../../composables/useIsMobile'
import { useSessionStore } from '../../stores/sessionStore'
import { useNotification } from '../../composables/useNotification'
import { useTabPreview, type TabCard } from '../../composables/useTabPreview'
import { getAllLeaves } from '../../types/pane'
import type { Workspace } from '../../types/workspace'
import WorkspaceList from './WorkspaceList.vue'
import WorkspaceListView from './WorkspaceListView.vue'
import WorkspaceTabGrid from './WorkspaceTabGrid.vue'
import TabOverview from './TabOverview.vue'
import CreateWorkspaceDialog from '../ui/CreateWorkspaceDialog.vue'
import { shallowReactive } from 'vue'
import TerminalPane from '../terminal/TerminalPane.vue'

const props = defineProps<{
  visible: boolean
  activePaneId: string | null
  termRefs: Record<string, InstanceType<typeof TerminalPane>>
}>()

const emit = defineEmits<{
  close: []
  activate: [paneId: string]
  'close-tab': [paneId: string]
  'new-tab': [cwd?: string]
  'rename-tab': [paneId: string, title: string]
}>()

const { workspaces, activeWorkspaceId, matchWorkspace, deleteWorkspace, activateWorkspace } = useWorkspaces()
const { isMobile } = useIsMobile()
const { t } = useI18n()
const session = useSessionStore()
const notif = useNotification()
const tabPreview = useTabPreview()

const closing = ref(false)
const backdropRef = ref<any>(null)
const tabOverviewRef = ref<InstanceType<typeof TabOverview> | null>(null)
const showCreateDialog = ref(false)
const renamingWorkspace = ref<Workspace | null>(null)

// Remember last active tab per workspace (workspaceId → paneId)
const workspaceActiveTab = new Map<string, string>()

// Desktop state — '__all__' = show all, null = "ungrouped", string = workspace id
const selectedWorkspaceId = ref<string | null>('__all__')

// Mobile state
const drilldownWorkspaceId = ref<string | null | undefined>(undefined)

// Capture all cards when visible
const allCards = ref<TabCard[]>([])

watch(
  () => props.visible,
  (v) => {
    if (v) {
      closing.value = false
      allCards.value = tabPreview.captureAll(session.tabs, props.termRefs, notif.unreadByPane)
      // Restore last active workspace selection
      selectedWorkspaceId.value = activeWorkspaceId.value ?? '__all__'
      drilldownWorkspaceId.value = undefined
      nextTick(() => backdropRef.value?.$el?.focus?.())
    } else {
      closing.value = true
    }
  },
)

// Update cards when tabs change while open
watch(
  () => session.tabs.length,
  () => {
    if (props.visible) {
      allCards.value = tabPreview.captureAll(session.tabs, props.termRefs, notif.unreadByPane)
    }
  },
)

// Track active tab per workspace
watch(
  () => props.activePaneId,
  (paneId) => {
    if (paneId && selectedWorkspaceId.value && selectedWorkspaceId.value !== '__all__') {
      workspaceActiveTab.set(selectedWorkspaceId.value, paneId)
    }
  },
)

// Build tab→workspace mapping
interface CardGroup {
  workspaceId: string | null // null = ungrouped
  cards: TabCard[]
}

const tabCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const ws of workspaces.value) {
    counts[ws.id] = 0
  }
  for (const tab of session.tabs) {
    if (tab.type !== 'terminal') continue
    const cwd = tab.cwd
    if (!cwd) continue
    const ws = matchWorkspace(cwd)
    if (ws) counts[ws.id] = (counts[ws.id] || 0) + 1
  }
  return counts
})

const ungroupedCount = computed(() => {
  return allCards.value.filter((card) => getCardWorkspace(card) === null).length
})

function getCardWorkspace(card: TabCard): string | null {
  const tab = session.tabs.find((t) => t.paneId === card.paneId)
  if (!tab || tab.type !== 'terminal') return null
  const cwd = tab.cwd
  if (!cwd) return null
  const ws = matchWorkspace(cwd)
  return ws?.id ?? null
}

const filteredCards = computed(() => {
  let cards: TabCard[]
  // Mobile drilldown
  if (isMobile.value && drilldownWorkspaceId.value !== undefined) {
    const wsId = drilldownWorkspaceId.value
    cards = wsId === '__all__'
      ? allCards.value.filter((card) => getCardWorkspace(card) === null)
      : allCards.value.filter((card) => getCardWorkspace(card) === wsId)
  } else {
    // Desktop: '__all__' = ungrouped only, string = workspace id
    const sel = selectedWorkspaceId.value
    cards = sel === '__all__'
      ? allCards.value.filter((card) => getCardWorkspace(card) === null)
      : allCards.value.filter((card) => getCardWorkspace(card) === sel)
  }
  // Reindex for display (1-based)
  return cards.map((card, i) => ({ ...card, index: i + 1 }))
})

const drilldownWorkspace = computed((): Workspace | null => {
  if (drilldownWorkspaceId.value === undefined || drilldownWorkspaceId.value === null) return null
  return workspaces.value.find((w) => w.id === drilldownWorkspaceId.value) ?? null
})

function onSelectWorkspace(id: string | null) {
  // Save current active tab for the old workspace
  const oldId = selectedWorkspaceId.value
  if (oldId && oldId !== '__all__' && props.activePaneId) {
    workspaceActiveTab.set(oldId, props.activePaneId)
  }

  selectedWorkspaceId.value = id

  // Restore last active tab for the new workspace (without closing MC)
  if (id && id !== '__all__') {
    const saved = workspaceActiveTab.get(id)
    if (saved && filteredCards.value.some((c) => c.paneId === saved)) {
      session.setActivePane(saved)
    }
  }

  // Also activate globally so Cmd+T / + button inherit the workspace path
  activateWorkspace(id === '__all__' ? null : id).catch(() => {})
}

function onDrilldown(id: string | null) {
  // Save current active tab for the old workspace
  const oldId = drilldownWorkspaceId.value
  if (oldId && oldId !== '__all__' && props.activePaneId) {
    workspaceActiveTab.set(oldId, props.activePaneId)
  }

  drilldownWorkspaceId.value = id

  // Restore last active tab for the new workspace (without closing MC)
  if (id && id !== '__all__') {
    const saved = workspaceActiveTab.get(id)
    if (saved && filteredCards.value.some((c) => c.paneId === saved)) {
      session.setActivePane(saved)
    }
  }

  // Also activate globally
  activateWorkspace(id === '__all__' ? null : id).catch(() => {})
}

function onAddWorkspace() {
  showCreateDialog.value = true
}

function onWorkspaceCreated(id: string) {
  selectedWorkspaceId.value = id
  if (isMobile.value) {
    drilldownWorkspaceId.value = id
  }
}

function onRenameTab(paneId: string, title: string) {
  emit('rename-tab', paneId, title)
}

function onRenameWorkspace(id: string) {
  const ws = workspaces.value.find((w) => w.id === id)
  if (!ws) return
  renamingWorkspace.value = ws
}

function onNewTab(cwd?: string) {
  emit('new-tab', cwd)
}

const emptyPanelHint = computed(() => {
  const sel = selectedWorkspaceId.value
  if (sel === '__all__') {
    return workspaces.value.length > 0
      ? t('workspace.noUngrouped')
      : t('workspace.firstUse')
  }
  const ws = workspaces.value.find((w) => w.id === sel)
  return ws ? `${ws.name} — ${ws.path}` : ''
})

function onNewTabForSelected() {
  const sel = selectedWorkspaceId.value
  if (sel === '__all__' || sel === null) {
    emit('new-tab')
  } else {
    const ws = workspaces.value.find((w) => w.id === sel)
    emit('new-tab', ws?.path)
  }
}

function onSwitchWorkspace(direction: 'prev' | 'next') {
  // Build ordered list: all + workspaces
  const ids: (string | null)[] = ['__all__', ...workspaces.value.map((w) => w.id)]

  const cur = drilldownWorkspaceId.value
  if (cur === undefined) return
  const curIdx = ids.indexOf(cur)
  if (curIdx < 0) return

  let newIdx: number
  if (direction === 'next') {
    newIdx = (curIdx + 1) % ids.length
  } else {
    newIdx = (curIdx - 1 + ids.length) % ids.length
  }
  drilldownWorkspaceId.value = ids[newIdx]
}

function onKeydown(e: KeyboardEvent) {
  if (isMobile.value) return // Mobile handles its own gestures

  const ids: (string | null)[] = ['__all__', ...workspaces.value.map((w) => w.id)]
  if (ids.length === 0) return

  const curIdx = ids.indexOf(selectedWorkspaceId.value)

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      if (curIdx > 0) {
        onSelectWorkspace(ids[curIdx - 1])
      } else if (curIdx === -1 && ids.length > 0) {
        onSelectWorkspace(ids[0])
      }
      break
    case 'ArrowDown':
      e.preventDefault()
      if (curIdx < ids.length - 1) {
        onSelectWorkspace(ids[curIdx + 1])
      }
      break
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Enter':
      // Delegate to TabOverview for tab grid navigation
      tabOverviewRef.value?.onKeydown(e)
      break
    case 'n':
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onNewTabForSelected()
      }
      break
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      {
        const wsId = selectedWorkspaceId.value
        if (wsId !== null && wsId !== '__all__') {
          const ws = workspaces.value.find((w) => w.id === wsId)
          if (ws && confirm(`${t('workspace.delete')} "${ws.name}"?`)) {
            deleteWorkspace(wsId).catch((e) => console.error('Failed to delete workspace:', e))
          }
        }
      }
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}
</script>
