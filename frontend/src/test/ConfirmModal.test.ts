import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'

describe('ConfirmModal Esc 键支持', () => {
  it('visible=true + 按 Esc → emit cancel', async () => {
    const wrapper = mount(ConfirmModal, {
      props: {
        visible: true,
        title: '关闭标签页',
        message: '是否关闭此标签页?',
        target: 'tab-1',
        confirmText: '关闭',
        cancelText: '取消',
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    // 等待 microtask
    await wrapper.vm.$nextTick()

    const cancelEmits = wrapper.emitted('cancel')
    expect(cancelEmits).toBeDefined()
    expect(cancelEmits!.length).toBe(1)
  })

  it('visible=false + 按 Esc → 不 emit cancel', async () => {
    const wrapper = mount(ConfirmModal, {
      props: {
        visible: false,
        title: '关闭标签页',
        message: '是否关闭此标签页?',
        confirmText: '关闭',
        cancelText: '取消',
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    await wrapper.vm.$nextTick()

    const cancelEmits = wrapper.emitted('cancel')
    expect(cancelEmits).toBeUndefined()
  })

  it('visible=true + 按 Enter → 不 emit cancel', async () => {
    const wrapper = mount(ConfirmModal, {
      props: {
        visible: true,
        title: '关闭标签页',
        message: '是否关闭此标签页?',
        confirmText: '关闭',
        cancelText: '取消',
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    await wrapper.vm.$nextTick()

    const cancelEmits = wrapper.emitted('cancel')
    expect(cancelEmits).toBeUndefined()
  })

  it('onUnmounted 移除 keydown listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const wrapper = mount(ConfirmModal, {
      props: {
        visible: false,
        title: '关闭标签页',
        message: '是否关闭此标签页?',
        confirmText: '关闭',
        cancelText: '取消',
      },
    })
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    removeSpy.mockRestore()
  })

  it('visible: false→true 切换后 Esc 正常 emit', async () => {
    const wrapper = mount(ConfirmModal, {
      props: {
        visible: false,
        title: '关闭标签页',
        message: '是否关闭此标签页?',
        confirmText: '关闭',
        cancelText: '取消',
      },
    })
    await wrapper.setProps({ visible: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')?.length).toBe(1)
  })
})
