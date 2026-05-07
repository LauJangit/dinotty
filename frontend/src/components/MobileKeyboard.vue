<template>
  <div ref="barRef" id="mobile-kb" v-show="visible">
    <div id="mkb-kb-bar">
      <button
        type="button"
        class="mkb-collapse-btn"
        @mousedown.prevent="emit('update:visible', false)"
        @touchstart.prevent="emit('update:visible', false)"
      >▼</button>
    </div>

    <!-- Main keyboard panel -->
    <div id="mkb-main-panel" v-show="kbMode === 'default'">
      <!-- Row 1: ` 1-0 - = ⌫ -->
      <MkbRow :keys="row1" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      <!-- Row 2: tab q-p [ ] \ -->
      <MkbRow :keys="row2" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      <!-- Row 3: ⌨ a-l ; ' ↵ (stagger) -->
      <MkbRow :keys="row3" :state="modState" @key-press="onKeyPress" @special="onSpecial" stagger="asdf" />
      <!-- Row 4+5: ZXCV + bottom + arrows -->
      <div class="mkb-zxcv-bottom mkb-stagger-zxcv">
        <div class="mkb-zxcv-left">
          <MkbRow :keys="row4zxcv" :state="modState" @key-press="onKeyPress" @special="onSpecial" row-class="mkb-row-zxcv" />
          <MkbRow :keys="row5bottom" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
        </div>
        <div class="mkb-arrow-cluster">
          <div class="mkb-arrow-row mkb-arrow-top">
            <MkbKey :k="arrowUp" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
          <div class="mkb-arrow-row">
            <MkbKey v-for="k in arrowBottomKeys" :key="k.l" :k="k" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
        </div>
      </div>
    </div>

    <!-- Action panel -->
    <div id="mkb-action-panel" v-show="kbMode === 'action'">
      <MkbRow :keys="actionFirstRow" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      <MkbRow
        v-for="(r, i) in actionFollowingRows"
        :key="i"
        :keys="r"
        :state="modState"
        @key-press="onKeyPress"
        @special="onSpecial"
      />
      <div class="mkb-action-arrow-enter">
        <div class="mkb-action-arrowpad">
          <div class="mkb-action-arrow-top">
            <MkbKey :k="actionArrowUp" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
          <div class="mkb-action-arrow-bot">
            <MkbKey v-for="k in actionArrowBot" :key="k.l" :k="k" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
        </div>
        <MkbKey :k="actionEnter" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MkbRow from './MkbRow.vue'
import MkbKey from './MkbKey.vue'
import type { KeyDef, ModState } from './mkbTypes'
import { useSettings, DEFAULT_ACTION_KEYBOARD } from '../composables/useSettings'
import { mapActionKeys } from '../utils/actionKeyDef'

const props = defineProps<{
  visible: boolean
  getSendFn: () => ((data: string) => void) | null
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
}>()

const { settings } = useSettings()

const barRef = ref<HTMLElement>()
const kbMode = ref<'default' | 'action'>('action')

const modState = reactive<ModState>({
  shift: false,
  ctrl: false,
  alt: false,
})

// Key definitions
const row1: KeyDef[] = [
  { l:'`', sl:'~', s:'`' }, { l:'1',sl:'!',s:'1' }, { l:'2',sl:'@',s:'2' },
  { l:'3',sl:'#',s:'3' }, { l:'4',sl:'$',s:'4' }, { l:'5',sl:'%',s:'5' },
  { l:'6',sl:'^',s:'6' }, { l:'7',sl:'&',s:'7' }, { l:'8',sl:'*',s:'8' },
  { l:'9',sl:'(',s:'9' }, { l:'0',sl:')',s:'0' }, { l:'-',sl:'_',s:'-' },
  { l:'=',sl:'+',s:'=' }, { l:'⌫', s:'\x7f', g:1.5, cls:'mkb-mod', repeat:true },
]

const row2: KeyDef[] = [
  { l:'tab', s:'\x09', g:1.5, cls:'mkb-mod' },
  { l:'q',s:'q' }, { l:'w',s:'w' }, { l:'e',s:'e' }, { l:'r',s:'r' },
  { l:'t',s:'t' }, { l:'y',s:'y' }, { l:'u',s:'u' }, { l:'i',s:'i' },
  { l:'o',s:'o' }, { l:'p',s:'p' },
  { l:'[',sl:'{',s:'[' }, { l:']',sl:'}',s:']' }, { l:'\\',sl:'|',s:'\\', g:1.5, cls:'mkb-mod' },
]

const row3: KeyDef[] = [
  { l:'⌨', sp:'kbswitch', g:1.7, cls:'mkb-mod', id:'mkb-kbswitch' },
  { l:'a',s:'a' }, { l:'s',s:'s' }, { l:'d',s:'d' }, { l:'f',s:'f' },
  { l:'g',s:'g' }, { l:'h',s:'h' }, { l:'j',s:'j' }, { l:'k',s:'k' },
  { l:'l',s:'l' }, { l:';',sl:':',s:';' }, { l:"'",sl:'"',s:"'" },
  { l:'↵', s:'\r', g:1.5, cls:'mkb-mod mkb-return' },
]

const row4zxcv: KeyDef[] = [
  { l:'⇧', sp:'shift', g:2.5, cls:'mkb-mod', id:'mkb-shift' },
  { l:'z',s:'z' }, { l:'x',s:'x' }, { l:'c',s:'c' }, { l:'v',s:'v' },
  { l:'b',s:'b' }, { l:'n',s:'n' }, { l:'m',s:'m' },
  { l:',',sl:'<',s:',',cls:'mkb-alpha' }, { l:'.',sl:'>',s:'.',cls:'mkb-alpha' }, { l:'/',sl:'?',s:'/',cls:'mkb-alpha' },
]

const row5bottom: KeyDef[] = [
  { l:'fn', sp:'fn', g:1, cls:'mkb-mod' },
  { l:'ctrl', sp:'ctrl', g:1, cls:'mkb-mod', id:'mkb-ctrl' },
  { l:'opt', sp:'alt', g:1, cls:'mkb-mod', id:'mkb-alt' },
  { l:'⌘', sp:'cmd', g:1, cls:'mkb-mod' },
  { l:'', s:' ', g:4, id:'mkb-space' },
]

const arrowUp: KeyDef = { l:'↑', s:'\x1b[A', repeat:true, cls:'mkb-arrow' }
const arrowBottomKeys: KeyDef[] = [
  { l:'←', s:'\x1b[D', repeat:true, cls:'mkb-arrow' },
  { l:'↓', s:'\x1b[B', repeat:true, cls:'mkb-arrow' },
  { l:'→', s:'\x1b[C', repeat:true, cls:'mkb-arrow' },
]

const kbswitchAction: KeyDef = {
  l: '⌨',
  sp: 'kbswitch',
  g: 1.5,
  cls: 'mkb-mod mkb-action-back',
  id: 'mkb-kbswitch2',
}

const actionFirstRow = computed(() => {
  const cfg = settings.action_keyboard ?? DEFAULT_ACTION_KEYBOARD
  const rows = cfg.rows?.length ? cfg.rows : DEFAULT_ACTION_KEYBOARD.rows
  const first = rows[0] ?? []
  return [kbswitchAction, ...mapActionKeys(first, false)]
})

const actionFollowingRows = computed(() => {
  const cfg = settings.action_keyboard ?? DEFAULT_ACTION_KEYBOARD
  const rows = cfg.rows?.length ? cfg.rows : DEFAULT_ACTION_KEYBOARD.rows
  if (rows.length < 2) return []
  const tail = rows.slice(1)
  return tail.map((r, i) => mapActionKeys(r ?? [], i === tail.length - 1))
})

const actionArrowUp: KeyDef = { l:'↑', s:'\x1b[A', cls:'mkb-mod mkb-action-arrow', repeat:true }

const actionArrowBot: KeyDef[] = [
  { l:'←', s:'\x1b[D', cls:'mkb-mod mkb-action-arrow', repeat:true },
  { l:'↓', s:'\x1b[B', cls:'mkb-mod mkb-action-arrow', repeat:true },
  { l:'→', s:'\x1b[C', cls:'mkb-mod mkb-action-arrow', repeat:true },
]

const actionEnter: KeyDef = { l:'↵', s:'\r', cls:'mkb-mod mkb-action-enter mkb-return' }

function onKeyPress(ch: string) {
  let data = ch
  if (data.length !== 1) {
    modState.ctrl = false
    modState.alt = false
    modState.shift = false
    props.getSendFn()?.(data)
    return
  }
  const cc = data.charCodeAt(0)
  if (cc < 32 || cc === 127) {
    modState.ctrl = false
    modState.alt = false
    modState.shift = false
    props.getSendFn()?.(data)
    return
  }
  if (modState.ctrl) {
    const code = data.toUpperCase().charCodeAt(0) - 64
    if (code >= 1 && code <= 26) data = String.fromCharCode(code)
    modState.ctrl = false
  }
  if (modState.alt) {
    data = '\x1b' + data
    modState.alt = false
  }
  if (modState.shift) modState.shift = false

  props.getSendFn()?.(data)
}

function onSpecial(sp: string) {
  if (sp === 'shift') modState.shift = !modState.shift
  if (sp === 'ctrl') modState.ctrl = !modState.ctrl
  if (sp === 'alt') modState.alt = !modState.alt
  if (sp === 'kbswitch') {
    kbMode.value = kbMode.value === 'action' ? 'default' : 'action'
    nextTick(() => updateHeight())
  }
}

function updateHeight() {
  if (!barRef.value) return
  const h = props.visible ? barRef.value.getBoundingClientRect().height : 0
  document.documentElement.style.setProperty('--mkb-height', `${h}px`)
}

// Viewport listener for system keyboard detection
let naturalVH = 0

function onViewportChange() {
  if (!window.visualViewport) return
  const vh = window.visualViewport.height
  if (vh > naturalVH) naturalVH = vh
  const off = window.innerHeight - (window.visualViewport.offsetTop + vh)
  const sysKbOpen = (naturalVH - vh) > 120
  if (barRef.value) {
    barRef.value.style.display = (sysKbOpen || !props.visible) ? 'none' : ''
    if (!sysKbOpen && props.visible) barRef.value.style.bottom = `${Math.max(0, off)}px`
  }
  updateHeight()
}

watch(() => props.visible, (v) => {
  nextTick(() => updateHeight())
})

onMounted(() => {
  if (window.visualViewport) {
    naturalVH = window.visualViewport.height
    window.visualViewport.addEventListener('resize', onViewportChange)
    window.visualViewport.addEventListener('scroll', onViewportChange)
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { naturalVH = window.visualViewport!.height }, 300)
    })
  }

  let roAf = 0
  if (barRef.value) {
    new ResizeObserver(() => {
      cancelAnimationFrame(roAf)
      roAf = requestAnimationFrame(() => updateHeight())
    }).observe(barRef.value)
  }
})

onBeforeUnmount(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportChange)
    window.visualViewport.removeEventListener('scroll', onViewportChange)
  }
  document.documentElement.style.setProperty('--mkb-height', '0px')
})
</script>
