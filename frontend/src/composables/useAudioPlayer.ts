import { ref, computed, type Ref, type ComputedRef } from 'vue'

export interface AudioPlayer {
  audioPlaying: Ref<boolean>
  audioCurrent: Ref<number>
  audioDuration: Ref<number>
  audioVolValue: Ref<number>
  audioSeekValue: ComputedRef<number>
  audioTimeNow: ComputedRef<string>
  audioTimeTotal: ComputedRef<string>
  toggleAudio: (el: HTMLAudioElement | null) => void
  seekAudio: (el: HTMLAudioElement | null, deltaSec: number) => void
  onAudioSeekInput: (el: HTMLAudioElement | null, ev: Event) => void
  onAudioVolumeInput: (el: HTMLAudioElement | null, ev: Event) => void
  onAudioTimeUpdate: (el: HTMLAudioElement | null) => void
  onAudioLoadedMetadata: (el: HTMLAudioElement | null) => void
  onAudioEnded: () => void
  resetAudio: (el: HTMLAudioElement | null) => void
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '00:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const mm = String(m).padStart(2, '0')
  const sss = String(ss).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${sss}` : `${mm}:${sss}`
}

export function useAudioPlayer(): AudioPlayer {
  const audioPlaying = ref(false)
  const audioCurrent = ref(0)
  const audioDuration = ref(0)
  const audioVolValue = ref(100)

  const audioSeekValue = computed(() => {
    const d = audioDuration.value
    if (!d || !Number.isFinite(d)) return 0
    const v = (audioCurrent.value / d) * 1000
    return Math.max(0, Math.min(1000, Math.round(v)))
  })

  const audioTimeNow = computed(() => fmtTime(audioCurrent.value))
  const audioTimeTotal = computed(() => fmtTime(audioDuration.value))

  function syncVol(el: HTMLAudioElement | null) {
    if (!el) return
    el.volume = Math.max(0, Math.min(1, audioVolValue.value / 100))
  }

  function toggleAudio(el: HTMLAudioElement | null) {
    if (!el) return
    syncVol(el)
    if (el.paused) {
      void el.play().then(
        () => (audioPlaying.value = true),
        () => (audioPlaying.value = false),
      )
    } else {
      el.pause()
      audioPlaying.value = false
    }
  }

  function seekAudio(el: HTMLAudioElement | null, deltaSec: number) {
    if (!el) return
    const d = Number.isFinite(el.duration) ? el.duration : audioDuration.value
    const next = Math.max(0, Math.min(d || Infinity, (Number.isFinite(el.currentTime) ? el.currentTime : 0) + deltaSec))
    el.currentTime = next
    audioCurrent.value = next
  }

  function onAudioSeekInput(el: HTMLAudioElement | null, ev: Event) {
    if (!el) return
    const v = (ev.target as HTMLInputElement).valueAsNumber
    const d = Number.isFinite(el.duration) ? el.duration : audioDuration.value
    if (!d || !Number.isFinite(d)) return
    const next = (Math.max(0, Math.min(1000, v)) / 1000) * d
    el.currentTime = next
    audioCurrent.value = next
  }

  function onAudioVolumeInput(el: HTMLAudioElement | null, ev: Event) {
    audioVolValue.value = (ev.target as HTMLInputElement).valueAsNumber
    syncVol(el)
  }

  function onAudioTimeUpdate(el: HTMLAudioElement | null) {
    if (!el) return
    audioCurrent.value = Number.isFinite(el.currentTime) ? el.currentTime : 0
    audioDuration.value = Number.isFinite(el.duration) ? el.duration : audioDuration.value
    audioPlaying.value = !el.paused
  }

  function onAudioLoadedMetadata(el: HTMLAudioElement | null) {
    if (!el) return
    audioDuration.value = Number.isFinite(el.duration) ? el.duration : 0
    audioCurrent.value = Number.isFinite(el.currentTime) ? el.currentTime : 0
    syncVol(el)
  }

  function onAudioEnded() {
    audioPlaying.value = false
  }

  function resetAudio(el: HTMLAudioElement | null) {
    if (el) el.pause()
    audioPlaying.value = false
    audioCurrent.value = 0
    audioDuration.value = 0
  }

  return {
    audioPlaying, audioCurrent, audioDuration, audioVolValue,
    audioSeekValue, audioTimeNow, audioTimeTotal,
    toggleAudio, seekAudio, onAudioSeekInput, onAudioVolumeInput,
    onAudioTimeUpdate, onAudioLoadedMetadata, onAudioEnded, resetAudio,
  }
}
