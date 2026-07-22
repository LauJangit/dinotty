<template>
  <button
    type="button"
    class="status-bar-item"
    :class="{ 'has-error': hasError, 'has-onclick': !!item.onClick }"
    :title="effectiveTooltip"
    @click="handleClick"
  >
    <component :is="renderComp" />
  </button>
</template>

<script setup lang="ts">
import { defineComponent, h, ref, computed } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import type { StatusBarItem } from '../../stores/statusBarItems'
import { useStatusBarItemsStore } from '../../stores/statusBarItems'

const props = defineProps<{ item: StatusBarItem }>()
const store = useStatusBarItemsStore()

const error = ref<string | null>(null)

const renderComp = defineComponent({
  name: `StatusBarItem_${props.item.id}`,
  setup() {
    return () => {
      try {
        const vnode = props.item.render()
        if (error.value) {
          error.value = null
          store.reportSuccess(props.item.id)
        }
        return vnode
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        error.value = msg
        store.reportFailure(props.item.id, err)
        return h(CircleAlert, { size: 14 })
      }
    }
  },
})

const hasError = computed(() => error.value !== null)

const effectiveTooltip = computed(() => {
  if (error.value) return `Render failed: ${error.value}`
  return props.item.tooltip
})

function handleClick(e: MouseEvent) {
  if (error.value) return
  props.item.onClick?.(e)
}
</script>

<style scoped>
.status-bar-item {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1;
  transition: color 0.15s;
  flex-shrink: 0;
}
.status-bar-item:not(.has-onclick) {
  cursor: default;
}
.status-bar-item:hover {
  color: var(--fg-bright);
}
.status-bar-item.has-error {
  color: var(--danger);
  cursor: help;
}
/* Force plugin-rendered descendants to inherit the button's muted color so
   that plugin metrics match the system metric color (var(--fg-muted)). The
   leading `.status-bar-item` raises specificity to (0,2,0) so this wins over
   plugin CSS class rules (0,1,0) but still yields to equal-specificity plugin
   rules that come later in the cascade — e.g. `.value.is-high` keeps its red
   warning color. Inline styles and !important still override this rule. */
.status-bar-item :deep(*) {
  color: inherit;
}
:deep(.metric-content) {
  display: flex;
  align-items: center;
  gap: 4px;
}
:deep(.metric-value) {
  font-variant-numeric: tabular-nums;
}
</style>
