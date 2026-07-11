<template>
  <div class="notification-card" :class="[`type-${type}`]" @click="$emit('goto')">
    <div class="card-stripe"></div>
    <div class="card-content">
      <div class="card-header">
        <span class="card-dot"></span>
        <span class="card-title">{{ title || body }}</span>
        <button class="card-close" @click.stop="$emit('dismiss')">
          <X :size="12" />
        </button>
      </div>
      <div v-if="title && body" class="card-body">{{ body }}</div>
      <div class="card-footer">
        <span v-if="paneLabel" class="card-pane">{{ paneLabel }}</span>
        <span class="card-time">{{ formattedTime }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import type { NotificationType } from '../../composables/useNotification'

const props = defineProps<{
  type: NotificationType
  title: string | null
  body: string
  timestamp: number
  paneLabel?: string
}>()

defineEmits<{ dismiss: []; goto: [] }>()

const formattedTime = computed(() => {
  const d = new Date(props.timestamp)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})
</script>

<style scoped>
.notification-card {
  display: flex;
  border-radius: 6px;
  background: var(--bg-surface, #1e1e2e);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.notification-card:hover {
  background: var(--tab-hover-bg, #2a2a3e);
}
.card-stripe {
  width: 3px;
  border-radius: 6px 0 0 6px;
  flex-shrink: 0;
}
.type-info .card-stripe,
.type-info .card-dot {
  background: var(--accent, #8a8a8a);
}
.type-success .card-stripe,
.type-success .card-dot {
  background: var(--color-green, #34d399);
}
.type-warning .card-stripe,
.type-warning .card-dot {
  background: var(--color-yellow, #f59e0b);
}
.type-error .card-stripe,
.type-error .card-dot {
  background: var(--color-red, #ef4444);
}
.type-urgent .card-stripe,
.type-urgent .card-dot {
  background: var(--color-red, #ef4444);
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.card-content {
  flex: 1;
  padding: 10px 12px;
  min-width: 0;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.card-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.card-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-bright, #fff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-close {
  background: none;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 2px;
  line-height: 1;
  display: flex;
  align-items: center;
  border-radius: 3px;
}
.card-close:hover {
  color: var(--fg);
  background: var(--bg-hover);
}
.card-body {
  margin-top: 4px;
  font-size: 12px;
  color: var(--fg);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.card-footer {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--fg-muted);
}
.card-pane {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
</style>
