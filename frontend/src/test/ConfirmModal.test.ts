import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'

let wrapper: VueWrapper | undefined

function mountModal(visible = true) {
  wrapper = mount(ConfirmModal, {
    props: {
      visible,
      title: '关闭标签页',
      message: '是否关闭此标签页?',
      confirmText: '关闭',
      cancelText: '取消',
    },
  })
  return wrapper
}

function dispatchKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})

describe('ConfirmModal 键盘行为', () => {
  it('visible=true + 按 Esc → emit cancel', async () => {
    const modal = mountModal(true)

    dispatchKey('Escape')
    await nextTick()

    expect(modal.emitted('cancel')?.length).toBe(1)
    expect(modal.emitted('confirm')).toBeUndefined()
  })

  it('visible=false + 按 Esc → 不 emit cancel', async () => {
    const modal = mountModal(false)

    dispatchKey('Escape')
    await nextTick()

    expect(modal.emitted('cancel')).toBeUndefined()
    expect(modal.emitted('confirm')).toBeUndefined()
  })

  it('visible=true + 按 Enter → 触发当前聚焦的取消按钮', async () => {
    const modal = mountModal(true)

    dispatchKey('Enter')
    await nextTick()

    expect(modal.emitted('cancel')?.length).toBe(1)
    expect(modal.emitted('confirm')).toBeUndefined()
  })

  it('焦点切换后按 Enter → emit confirm', async () => {
    const modal = mountModal(true)

    dispatchKey('ArrowRight')
    dispatchKey('Enter')
    await nextTick()

    expect(modal.emitted('confirm')?.length).toBe(1)
    expect(modal.emitted('cancel')).toBeUndefined()
  })

  it('焦点可往返切换，回到取消后 Enter → emit cancel', async () => {
    const modal = mountModal(true)

    dispatchKey('ArrowRight')
    dispatchKey('ArrowLeft')
    dispatchKey('Enter')
    await nextTick()

    expect(modal.emitted('cancel')?.length).toBe(1)
    expect(modal.emitted('confirm')).toBeUndefined()
  })

  it('Tab 也能在取消和确认之间切换', async () => {
    const modal = mountModal(true)

    dispatchKey('Tab')
    dispatchKey('Enter')
    await nextTick()

    expect(modal.emitted('confirm')?.length).toBe(1)
    expect(modal.emitted('cancel')).toBeUndefined()
  })

  it('hidden 状态下 Arrow/Tab/Enter/Escape 都不触发', async () => {
    const modal = mountModal(false)

    for (const key of ['ArrowRight', 'Tab', 'Enter', 'Escape']) dispatchKey(key)
    await nextTick()

    expect(modal.emitted('confirm')).toBeUndefined()
    expect(modal.emitted('cancel')).toBeUndefined()
  })

  it('onUnmounted 移除 keydown listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const modal = mountModal(false)

    modal.unmount()
    wrapper = undefined

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  })

  it('visible: false→true 切换后 Esc 正常 emit', async () => {
    const modal = mountModal(false)

    await modal.setProps({ visible: true })
    dispatchKey('Escape')
    await nextTick()

    expect(modal.emitted('cancel')?.length).toBe(1)
  })
})
