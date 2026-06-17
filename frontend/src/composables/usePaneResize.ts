import { ref, type Ref } from 'vue'

function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0]
    return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: e.clientX, clientY: e.clientY }
}

function startPaneResizeInternal(
  e: MouseEvent | TouchEvent,
  panelSelector: string,
  direction: Ref<'horizontal' | 'vertical'>,
  reversed: Ref<boolean>,
) {
  const el = (e.target as HTMLElement).closest(panelSelector) as HTMLElement
  const parent = el?.parentElement
  if (!parent) return

  const isTouch = 'touches' in e
  const horiz = direction.value === 'horizontal'

  const overlay = isTouch
    ? null
    : (() => {
        const d = document.createElement('div')
        d.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
        document.body.appendChild(d)
        return d
      })()

  const onMove = (ev: MouseEvent | TouchEvent) => {
    if ('touches' in ev) ev.preventDefault()
    const pos = getPointerPos(ev as MouseEvent | TouchEvent)
    const rect = parent.getBoundingClientRect()
    const total = horiz ? rect.width : rect.height
    const offset = horiz ? pos.clientX - rect.left : pos.clientY - rect.top
    const raw = Math.max(15, Math.min(85, (offset / total) * 100))
    const termPct = reversed.value ? 100 - raw : raw
    const termChild = parent.querySelector(':scope > .terminal-pane-container') as HTMLElement
    const previewChild = parent.querySelector(`:scope > ${panelSelector}`) as HTMLElement
    if (termChild) termChild.style.flex = `0 0 ${termPct}%`
    if (previewChild) previewChild.style.flex = `0 0 ${100 - termPct}%`
  }

  const moveEvent = isTouch ? 'touchmove' : 'mousemove'
  const endEvent = isTouch ? 'touchend' : 'mouseup'

  const onEnd = () => {
    overlay?.remove()
    window.removeEventListener(moveEvent, onMove as EventListener)
    window.removeEventListener(endEvent, onEnd)
    window.dispatchEvent(new Event('resize'))
  }

  window.addEventListener(moveEvent, onMove as EventListener, { passive: !isTouch } as AddEventListenerOptions)
  window.addEventListener(endEvent, onEnd)
}

export function usePaneResize(
  panelSelector: string,
  direction: Ref<'horizontal' | 'vertical'>,
  reversed?: Ref<boolean>,
) {
  const rev = reversed ?? ref(false)
  return {
    startDrag(e: MouseEvent | TouchEvent) {
      startPaneResizeInternal(e, panelSelector, direction, rev)
    },
  }
}
