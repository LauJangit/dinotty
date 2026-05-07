<template>
  <button
    ref="btnRef"
    id="kb-toggle-btn"
    :class="{ active: visible }"
    title="Toggle Keyboard"
    @click="$emit('toggle')"
  >⌨</button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useDraggable } from '../composables/useDraggable'

defineProps<{
  visible: boolean
}>()

defineEmits<{
  toggle: []
}>()

const btnRef = ref<HTMLElement>()

onMounted(() => {
  if (btnRef.value) {
    useDraggable(btnRef.value)
  }
})
</script>
