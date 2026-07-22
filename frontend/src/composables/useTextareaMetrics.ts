import { type Ref } from 'vue'

export interface TextareaMetrics {
  padTop: number
  padBottom: number
  borderTop: number
  borderBottom: number
  chromeFloor: number
  one: number
  max: number
}

export interface TextareaMetricsOptions {
  textInputRef: Ref<HTMLTextAreaElement | null | undefined>
  barRef: Ref<HTMLElement | null | undefined>
  updateHeight: () => void
}

export interface TextareaMetricsState {
  resetTextareaMetrics: () => void
  getTextareaMetrics: () => TextareaMetrics | null
  restoreTextInputPadding: (el: HTMLTextAreaElement, metrics: TextareaMetrics) => void
  resetTextInputHeight: () => void
  resizeTextInput: () => void
}

export function useTextareaMetrics(opts: TextareaMetricsOptions): TextareaMetricsState {
  const { textInputRef, barRef, updateHeight } = opts

  let textareaMetrics: TextareaMetrics | null = null

  function resetTextareaMetrics() {
    textareaMetrics = null
  }

  function px(value: string) {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : 0
  }

  function getTextareaMetrics() {
    if (textareaMetrics) return textareaMetrics
    const el = textInputRef.value
    if (!el) return null

    const style = getComputedStyle(el)
    const fontSize = px(style.fontSize)
    let lineHeight = px(style.lineHeight)
    if (!lineHeight) lineHeight = fontSize * 1.4

    const padTop = px(style.paddingTop)
    const padBottom = px(style.paddingBottom)
    const borderTop = px(style.borderTopWidth)
    const borderBottom = px(style.borderBottomWidth)
    const chromeFloor = padTop + padBottom + borderTop + borderBottom
    textareaMetrics = {
      padTop,
      padBottom,
      borderTop,
      borderBottom,
      chromeFloor,
      one: Math.ceil(lineHeight + chromeFloor),
      max: Math.ceil(lineHeight * 3 + chromeFloor),
    }
    return textareaMetrics
  }

  function restoreTextInputPadding(el: HTMLTextAreaElement, metrics: TextareaMetrics) {
    el.style.paddingTop = `${metrics.padTop}px`
    el.style.paddingBottom = `${metrics.padBottom}px`
  }

  function resetTextInputHeight() {
    const el = textInputRef.value
    const metrics = getTextareaMetrics()
    if (!el || !metrics) return
    restoreTextInputPadding(el, metrics)
    el.style.height = `${metrics.one}px`
    el.style.overflowY = 'hidden'
  }

  function resizeTextInput() {
    const el = textInputRef.value
    const metrics = getTextareaMetrics()
    if (!el || !metrics) return

    const previousHeight = el.getBoundingClientRect().height
    restoreTextInputPadding(el, metrics)
    el.style.height = `${metrics.one}px`

    const needed = el.scrollHeight + metrics.borderTop + metrics.borderBottom
    const barHeight =
      barRef.value?.getBoundingClientRect().height ?? el.getBoundingClientRect().height
    const reserved = Math.max(0, barHeight - el.offsetHeight)
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const availPx = viewportHeight - reserved
    const cap = Math.min(metrics.max, Math.max(0, availPx))
    const next = Math.min(cap, Math.max(0, needed))

    el.style.height = `${next}px`
    if (next < metrics.chromeFloor) {
      el.style.paddingTop = '0'
      el.style.paddingBottom = '0'
    } else {
      restoreTextInputPadding(el, metrics)
    }
    el.style.overflowY = needed > next + 1 ? 'auto' : 'hidden'

    if (Math.abs(el.getBoundingClientRect().height - previousHeight) > 0.5) {
      updateHeight()
    }
  }

  return {
    resetTextareaMetrics,
    getTextareaMetrics,
    restoreTextInputPadding,
    resetTextInputHeight,
    resizeTextInput,
  }
}
