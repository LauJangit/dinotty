<template>
  <component :is="icon" :size="size" :stroke-width="2" class="ws-icon" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Folder, Server } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  remote?: boolean
  size?: number
}>(), {
  remote: false,
  size: 18,
})

const icon = computed(() => (props.remote ? Server : Folder))
</script>

<style scoped>
.ws-icon {
  color: var(--fg-bright);
  flex-shrink: 0;
}
</style>
