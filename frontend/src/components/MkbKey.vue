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
import { computed } from 'vue'
import type { KeyDef, ModState } from './mkbTypes'
import { settings } from '../composables/useSettings'

let audioCtx: AudioContext | null = null

function playClick() {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 1800
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.008)
  osc.connect(gain).connect(audioCtx.destination)
  osc.start()
  osc.stop(audioCtx.currentTime + 0.01)
}

function feedback() {
  if (settings.keyboard_sound) playClick()
}

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

function fireWithFeedback() { feedback(); fire() }

function onDown() {
  fireWithFeedback()
  if (props.k.repeat) {
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(fireWithFeedback, 80)
    }, 400)
  }
}

function onUp() {
  if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null }
  if (repeatInterval) { clearInterval(repeatInterval); repeatInterval = null }
}
</script>
