import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { VocPortal, useVocUnread } from '../src/vue'
import { PORTAL_ORIGIN, emit, flush, frameIn, session, spyPost } from './helpers'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('VocPortal', () => {
  it('mounts the portal, emits events, follows props and cleans up', async () => {
    const getSession = vi.fn(async () => session())
    const wrapper = mount(VocPortal, {
      props: { getSession, route: '/tickets', locale: 'vi' },
      attachTo: document.body,
    })
    await flushPromises()
    await flush()

    const frame = frameIn(wrapper.element as HTMLElement)
    expect(frame.getAttribute('src')).toBe(`${PORTAL_ORIGIN}/portal/tickets?client=vk_obee_1`)
    const post = spyPost(frame)

    emit({ v: 1, type: 'voc.portal.ready' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.authenticated' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.navigate', route: '/tickets/5' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.unread', count: 2 }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.error', code: 'client_unknown' }, frame.contentWindow)

    expect(wrapper.emitted('navigate')).toEqual([['/tickets/5']])
    expect(wrapper.emitted('unread')).toEqual([[2]])
    expect(wrapper.emitted('error')).toEqual([['client_unknown', undefined]])

    await wrapper.setProps({ route: '/tickets/5' })
    expect(post).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ route: '/notifications' })
    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'voc.portal.navigate', route: '/notifications' }, PORTAL_ORIGIN)
    await wrapper.setProps({ locale: 'en' })
    expect(post).toHaveBeenLastCalledWith(
      { v: 1, type: 'voc.portal.auth', token: 'tok-1', expires_at: '2026-11-16T11:00:00.000000Z', locale: 'en' },
      PORTAL_ORIGIN,
    )

    wrapper.unmount()
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('useVocUnread', () => {
  it('polls immediately and on the interval, keeps the last value on failure and stops on unmount', async () => {
    vi.useFakeTimers()
    const fetchCount = vi
      .fn<() => Promise<number | { count: number }>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce({ count: 4 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(9)

    let unread: ReturnType<typeof useVocUnread> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          unread = useVocUnread(fetchCount, 5_000)

          return () => h('span', unread?.value)
        },
      }),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(unread?.value).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(unread?.value).toBe(4)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(unread?.value).toBe(4)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchCount).toHaveBeenCalledTimes(3)
  })
})
