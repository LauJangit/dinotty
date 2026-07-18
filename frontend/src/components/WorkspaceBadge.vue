<template>
  <span
    class="ws-badge"
    :style="{
      '--wb-border': border,
      '--wb-size': `${size}px`,
      '--wb-font-size': `${size * 0.5}px`,
    }"
  >{{ abbr }}</span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { outlineColor } from '../utils/workspaceIcon'

const props = withDefaults(defineProps<{
  abbr: string
  color: string
  size?: number
  cardBgVar?: string
}>(), {
  size: 20,
  cardBgVar: '--bg-surface',
})

const cardBg = ref('')
let themeObserver: MutationObserver | undefined

function readBg() {
  cardBg.value = getComputedStyle(document.documentElement)
    .getPropertyValue(props.cardBgVar)
    .trim()
}

onMounted(() => {
  readBg()
  themeObserver = new MutationObserver(readBg)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
})

const border = computed(() => (
  /^#[0-9A-Fa-f]{6}$/.test(cardBg.value)
    ? outlineColor(props.color, cardBg.value)
    : props.color
))
</script>

<style scoped>
.ws-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--wb-size);
  height: var(--wb-size);
  border: 1.5px solid var(--wb-border);
  border-radius: 5px;
  color: var(--fg-bright);
  font-family: inherit;
  font-size: var(--wb-font-size);
  font-weight: 600;
  line-height: 1;
  background: color-mix(in srgb, var(--wb-border) 14%, transparent);
  overflow: hidden;
  user-select: none;
}
</style>
