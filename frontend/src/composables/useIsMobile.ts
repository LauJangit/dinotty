import { ref } from 'vue'

const isMobile = ref(false)

const FORCE_KEY = 'dinotty:force-mobile'

function check() {
  const forced = localStorage.getItem(FORCE_KEY)
  if (forced === '1') { isMobile.value = true; return }
  if (forced === '0') { isMobile.value = false; return }

  const isCoarse = window.matchMedia('(pointer: coarse)').matches
  const isPortrait = window.matchMedia('(orientation: portrait)').matches
  const isNarrow = window.matchMedia('(max-width: 600px)').matches
  isMobile.value = isCoarse && (isPortrait || isNarrow)
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', check)
  window.addEventListener('orientationchange', check)
  check()
}

export function useIsMobile() {
  return { isMobile }
}
