<template>
  <button
    :class="['mkb-btn', k.cls]"
    :id="k.id"
    :style="{ flexGrow: k.g ?? 1, flexBasis: '0' }"
    @touchstart.prevent="onDown"
    @mousedown.prevent="onDown"
    @touchend="onUp"
    @touchcancel="onUp"
    @mouseup="onUp"
    @mouseleave="onUp"
  >{{ displayLabel }}</button>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { KeyDef, ModState } from './mkbTypes'

const props = defineProps<{
  k: KeyDef
  state: ModState
}>()

const emit = defineEmits<{
  'key-press': [ch: string]
  special: [sp: string]
}>()

const displayLabel = computed(() => {
  if (props.k.sl && props.state.shift) return props.k.sl
  if (props.k.s && props.k.s.length === 1 && props.k.s >= 'a' && props.k.s <= 'z' && props.state.shift) {
    return props.k.l.toUpperCase()
  }
  return props.k.l
})

let repeatTimer: ReturnType<typeof setTimeout> | null = null
let repeatInterval: ReturnType<typeof setInterval> | null = null

function fire() {
  if (props.k.sp) {
    emit('special', props.k.sp)
    return
  }
  if (!props.k.s) return

  let ch = props.k.s
  if (props.state.shift) {
    if (props.k.sl) ch = props.k.sl
    else if (ch >= 'a' && ch <= 'z') ch = ch.toUpperCase()
  }
  emit('key-press', ch)
}

function onDown() {
  fire()
  if (props.k.repeat) {
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(fire, 80)
    }, 400)
  }
}

function onUp() {
  if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null }
  if (repeatInterval) { clearInterval(repeatInterval); repeatInterval = null }
}
</script>
