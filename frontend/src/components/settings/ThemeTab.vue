<template>
  <div>
    <section class="settings-section">
      <h3>{{ t('settings.theme') }}</h3>
      <div class="theme-grid">
        <button
          v-for="th in themes"
          :key="th.name"
          class="theme-card"
          :class="{ active: settings.theme.preset === th.name }"
          @click="settings.theme.preset = th.name; selectTheme()"
        >
          <div class="theme-preview" :style="{ background: th.colors['--bg'] }">
            <div class="theme-preview-header">
              <span class="theme-dot" :style="{ background: th.colors['--color-red'] }"></span>
              <span class="theme-dot" :style="{ background: th.colors['--color-yellow'] }"></span>
              <span class="theme-dot" :style="{ background: th.colors['--color-green'] }"></span>
            </div>
            <div class="theme-preview-body">
              <span :style="{ color: th.colors['--color-green'] }">$</span>
              <span :style="{ color: th.colors['--fg'] }"> ls</span>
              <span :style="{ color: th.colors['--color-blue'] }"> ~/src</span>
            </div>
            <div class="theme-swatches">
              <span class="swatch" :style="{ background: th.colors['--color-red'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-green'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-yellow'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-blue'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-magenta'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-cyan'] }"></span>
            </div>
          </div>
          <span class="theme-name">{{ themeLabel(th.name) }}</span>
        </button>
      </div>
    </section>

    <section class="settings-section">
      <h3>{{ t('settings.customColors') }}</h3>
      <p class="settings-hint">{{ t('settings.customColorsHint') }}</p>
      <div class="custom-colors-grid">
        <label class="color-field">
          <span>{{ t('settings.color.fg') }}</span>
          <div class="color-input-wrap">
            <input type="color" :value="customFg" @input="setCustomColor('fg', $event)" />
            <span class="color-hex">{{ customFg }}</span>
          </div>
        </label>
        <label class="color-field">
          <span>{{ t('settings.color.bg') }}</span>
          <div class="color-input-wrap">
            <input type="color" :value="customBg" @input="setCustomColor('bg', $event)" />
            <span class="color-hex">{{ customBg }}</span>
          </div>
        </label>
        <label class="color-field">
          <span>{{ t('settings.color.cursor') }}</span>
          <div class="color-input-wrap">
            <input type="color" :value="customCursor" @input="setCustomColor('cursor', $event)" />
            <span class="color-hex">{{ customCursor }}</span>
          </div>
        </label>
      </div>
      <details class="ansi-details">
        <summary>{{ t('settings.color.ansi') }}</summary>
        <div class="ansi-grid">
          <label v-for="(c, i) in ansiColors" :key="i" class="ansi-field">
            <span class="ansi-label">{{ ansiNames[i] }}</span>
            <input type="color" :value="c" @input="setAnsiColor(i, $event)" />
          </label>
        </div>
      </details>
      <button class="shortcut-add" @click="resetCustomColors">{{ t('settings.color.reset') }}</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { themes, getThemeByName } from '../../themes'

const { settings, applyCurrentTheme } = useSettings()
const { t, themeLabel } = useI18n()

function selectTheme() {
  applyCurrentTheme()
}

const ansiNames = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
  'Bright Black', 'Bright Red', 'Bright Green', 'Bright Yellow', 'Bright Blue', 'Bright Magenta', 'Bright Cyan', 'Bright White']

const ansiColorKeys = [
  '--color-black', '--color-red', '--color-green', '--color-yellow',
  '--color-blue', '--color-magenta', '--color-cyan', '--color-white',
  '--color-bright-black', '--color-bright-red', '--color-bright-green', '--color-bright-yellow',
  '--color-bright-blue', '--color-bright-magenta', '--color-bright-cyan', '--color-bright-white',
]

function ensureCustom() {
  if (!settings.theme.custom) {
    settings.theme.custom = { foreground: undefined, background: undefined, cursor: undefined, ansi: undefined }
  }
  return settings.theme.custom!
}

const customFg = computed(() => {
  const c = settings.theme.custom
  if (c?.foreground) return c.foreground
  return getThemeByName(settings.theme.preset).colors['--fg']
})

const customBg = computed(() => {
  const c = settings.theme.custom
  if (c?.background) return c.background
  return getThemeByName(settings.theme.preset).colors['--bg']
})

const customCursor = computed(() => {
  const c = settings.theme.custom
  if (c?.cursor) return c.cursor
  return getThemeByName(settings.theme.preset).colors['--fg-muted']
})

const ansiColors = computed(() => {
  const theme = getThemeByName(settings.theme.preset)
  const custom = settings.theme.custom
  return ansiColorKeys.map((key, i) => {
    if (custom?.ansi?.[i]) return custom.ansi[i]
    return theme.colors[key]
  })
})

function setCustomColor(which: 'fg' | 'bg' | 'cursor', e: Event) {
  const val = (e.target as HTMLInputElement).value
  const custom = ensureCustom()
  if (which === 'fg') custom.foreground = val
  else if (which === 'bg') custom.background = val
  else custom.cursor = val
  applyCurrentTheme()
}

function setAnsiColor(index: number, e: Event) {
  const val = (e.target as HTMLInputElement).value
  const custom = ensureCustom()
  if (!custom.ansi) custom.ansi = []
  custom.ansi[index] = val
  applyCurrentTheme()
}

function resetCustomColors() {
  settings.theme.custom = null
  applyCurrentTheme()
}
</script>
