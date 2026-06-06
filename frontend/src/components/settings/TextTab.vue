<template>
  <div>
    <section class="settings-section">
      <h3>{{ t('settings.text') }}</h3>

      <div class="settings-row">
        <label>{{ t('settings.text.fontSize') }}</label>
        <div class="range-wrap">
          <input type="range" v-model.number="settings.text.font_size" min="8" max="32" step="1" @input="onTextSettingChange" />
          <span class="range-val">{{ settings.text.font_size }}px</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.fontFamily') }}</label>
        <div class="font-dropdown">
          <div class="font-dropdown-trigger shortcut-input" :style="{ fontFamily: settings.text.font_family || 'inherit' }" @click="toggleFontDropdown">
            <span>{{ currentFontLabel }}</span>
            <span class="font-dropdown-arrow">▾</span>
          </div>
          <div v-if="fontDropdownOpen" class="font-dropdown-backdrop" @click="closeFontDropdown"></div>
          <div v-if="fontDropdownOpen" class="font-dropdown-menu">
            <div
              class="font-dropdown-item"
              :class="{ active: !settings.text.font_family }"
              @click="selectFont('')"
            >
              <span class="font-item-label">{{ t('settings.text.fontFamilyDefault') }}</span>
            </div>
            <div
              v-for="font in fontFamilies"
              :key="font.value"
              class="font-dropdown-item"
              :class="{ active: settings.text.font_family === font.value }"
              :style="{ fontFamily: font.value }"
              @click="selectFont(font.value)"
            >
              <span class="font-item-label">{{ font.label }}</span>
              <span class="font-item-sample">Aa 01</span>
            </div>
            <div class="font-dropdown-divider"></div>
            <div
              class="font-dropdown-item"
              :class="{ active: isCustomFont || customFontEditing }"
              @click="enterCustomFont"
            >
              <span class="font-item-label">{{ t('settings.text.fontFamilyCustom') }}</span>
            </div>
            <div v-if="isCustomFont || customFontEditing" class="font-custom-input-wrap" @click.stop>
              <input
                ref="customFontInput"
                v-model="customFontName"
                class="shortcut-input font-custom-input"
                :placeholder="t('settings.text.fontFamilyCustomHint')"
                @keydown.enter="applyCustomFont"
                @blur="applyCustomFont"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.lineHeight') }}</label>
        <div class="range-wrap">
          <input type="range" v-model.number="settings.text.line_height" min="0.8" max="2.0" step="0.1" @input="onTextSettingChange" />
          <span class="range-val">{{ settings.text.line_height.toFixed(1) }}</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.letterSpacing') }}</label>
        <div class="range-wrap">
          <input type="range" v-model.number="settings.text.letter_spacing" min="0" max="4" step="0.5" @input="onTextSettingChange" />
          <span class="range-val">{{ settings.text.letter_spacing }}px</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.cursorStyle') }}</label>
        <select v-model="settings.text.cursor_style" class="shortcut-input" style="flex:1" @change="onTextSettingChange">
          <option value="block">{{ t('settings.text.cursor.block') }}</option>
          <option value="underline">{{ t('settings.text.cursor.underline') }}</option>
          <option value="bar">{{ t('settings.text.cursor.bar') }}</option>
        </select>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.cursorBlink') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.text.cursor_blink" @change="onTextSettingChange" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.scrollback') }}</label>
        <div class="range-wrap">
          <input type="range" v-model.number="settings.text.scrollback" min="1000" max="100000" step="1000" @input="onTextSettingChange" />
          <span class="range-val">{{ settings.text.scrollback.toLocaleString() }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useSettings, notifyTextChange } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'

const { settings } = useSettings()
const { t } = useI18n()

const fontFamilies = [
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Monaco', value: 'Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'SF Mono', value: '"SF Mono", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'FiraCode Nerd Font', value: '"FiraCode Nerd Font", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'IBM Plex Mono', value: '"IBM Plex Mono", monospace' },
  { label: 'Ubuntu Mono', value: '"Ubuntu Mono", monospace' },
]

const fontDropdownOpen = ref(false)
const customFontEditing = ref(false)
const customFontName = ref('')
const customFontInput = ref<HTMLInputElement | null>(null)

const isCustomFont = computed(() => {
  const current = settings.text.font_family
  if (!current) return false
  return !fontFamilies.some(f => f.value === current)
})

const currentFontLabel = computed(() => {
  const current = settings.text.font_family
  if (!current) return t('settings.text.fontFamilyDefault')
  const found = fontFamilies.find(f => f.value === current)
  if (found) return found.label
  return customFontName.value || current.replace(/, monospace$/, '')
})

function selectFont(value: string) {
  settings.text.font_family = value
  customFontEditing.value = false
  customFontName.value = ''
  fontDropdownOpen.value = false
  onTextSettingChange()
}

function enterCustomFont() {
  customFontEditing.value = true
  if (isCustomFont.value) {
    customFontName.value = settings.text.font_family.replace(/, monospace$/, '')
  }
  nextTick(() => customFontInput.value?.focus())
}

function toggleFontDropdown() {
  if (fontDropdownOpen.value) {
    closeFontDropdown()
    return
  }
  fontDropdownOpen.value = true
}

function closeFontDropdown() {
  fontDropdownOpen.value = false
  customFontEditing.value = false
}

function applyCustomFont() {
  const name = customFontName.value.trim()
  if (name) {
    settings.text.font_family = `${name}, monospace`
    onTextSettingChange()
  }
  closeFontDropdown()
}

let textChangeTimer: ReturnType<typeof setTimeout> | null = null

function onTextSettingChange() {
  if (textChangeTimer) clearTimeout(textChangeTimer)
  textChangeTimer = setTimeout(() => {
    notifyTextChange()
    textChangeTimer = null
  }, 100)
}

onBeforeUnmount(() => {
  if (textChangeTimer) clearTimeout(textChangeTimer)
})
</script>
