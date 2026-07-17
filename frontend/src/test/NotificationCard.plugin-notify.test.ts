import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import NotificationCard from '../components/notification/NotificationCard.vue'

const wrappers: VueWrapper[] = []

function mountCard(props: Partial<InstanceType<typeof NotificationCard>['$props']> = {}) {
  const wrapper = mount(NotificationCard, {
    props: {
      type: 'info',
      title: 'Hello',
      body: 'World',
      timestamp: Date.now(),
      ...props,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()!.unmount()
  vi.restoreAllMocks()
})

describe('NotificationCard - plugin notify support', () => {
  it('emits goto when paneLabel is present (terminal notification)', async () => {
    const wrapper = mountCard({ paneLabel: 'tab-1' })
    await wrapper.find('.notification-card').trigger('click')
    expect(wrapper.emitted('goto')).toHaveLength(1)
  })

  it('does NOT emit goto when paneLabel is absent (plugin notification)', async () => {
    const wrapper = mountCard()
    await wrapper.find('.notification-card').trigger('click')
    expect(wrapper.emitted('goto')).toBeUndefined()
  })

  it('does NOT emit goto when paneLabel is empty string', async () => {
    const wrapper = mountCard({ paneLabel: '' })
    await wrapper.find('.notification-card').trigger('click')
    expect(wrapper.emitted('goto')).toBeUndefined()
  })

  it('adds no-pane class when paneLabel is absent (cursor: default)', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.notification-card').classes()).toContain('no-pane')
  })

  it('does NOT add no-pane class when paneLabel is present', () => {
    const wrapper = mountCard({ paneLabel: 'tab-1' })
    expect(wrapper.find('.notification-card').classes()).not.toContain('no-pane')
  })

  it('shows [Plugin] source badge when source=plugin', () => {
    const wrapper = mountCard({ source: 'plugin' })
    expect(wrapper.find('.card-source').text()).toBe('Plugin')
  })

  it('does NOT show source badge when source=terminal', () => {
    const wrapper = mountCard({ source: 'terminal' })
    expect(wrapper.find('.card-source').exists()).toBe(false)
  })

  it('does NOT show source badge when source is undefined', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.card-source').exists()).toBe(false)
  })

  it('still shows pane label when both paneLabel and source=plugin are present', () => {
    const wrapper = mountCard({ paneLabel: 'tab-1', source: 'plugin' })
    expect(wrapper.find('.card-pane').text()).toBe('tab-1')
    expect(wrapper.find('.card-source').text()).toBe('Plugin')
  })
})
