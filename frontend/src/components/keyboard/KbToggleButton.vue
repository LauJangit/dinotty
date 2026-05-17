<template>
  <button

    id="kb-toggle-btn"
    :class="{ active: visible }"
    title="Toggle Keyboard"
    @click="$emit('toggle')"
    @touchend.prevent="$emit('toggle')"
  ><Keyboard :size="18" /></button>
</template>

<script setup lang="ts">
import { Keyboard } from 'lucide-vue-next'

defineProps<{
  visible: boolean
}>()

defineEmits<{
  toggle: []
}>()
</script>
