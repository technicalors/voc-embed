import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPortalSrc, mountVocPortal, type VocPortalHandle, type VocPortalOptions } from '../src'
import { PORTAL_ORIGIN, emit, flush, frameIn, session, spyPost } from './helpers'

const handles: VocPortalHandle[] = []

afterEach(() => {
  handles.splice(0).forEach((handle) => handle.destroy())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mount(options: Partial<VocPortalOptions> = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const getSession = options.getSession ?? vi.fn(async () => session())
  const handle = mountVocPortal(el, { getSession, ...options })
  handles.push(handle)
  await flush()

  return { el, handle, getSession }
}

describe('mountVocPortal', () => {
  it('creates a sandboxed iframe for the session portal URL', async () => {
    const { el, getSession } = await mount()
    const frame = frameIn(el)

    expect(getSession).toHaveBeenCalledWith({ refresh: false })
    expect(frame.getAttribute('src')).toBe(`${PORTAL_ORIGIN}/portal/tickets?client=vk_obee_1`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-downloads')
    expect(frame.getAttribute('allow')).toBe('clipboard-write')
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(frame.style.height).toBe('600px')
  })

  it('uses the initial route', async () => {
    const { el } = await mount({ route: '/tickets/42' })

    expect(frameIn(el).getAttribute('src')).toBe(`${PORTAL_ORIGIN}/portal/tickets/42?client=vk_obee_1`)
  })

  it('answers ready only for the iframe window at the portal origin', async () => {
    const { el } = await mount({ locale: 'vi-VN', theme: 'dark' })
    const frame = frameIn(el)
    const post = spyPost(frame)

    emit({ v: 1, type: 'voc.portal.ready' }, frame.contentWindow, 'https://evil.test')
    emit({ v: 1, type: 'voc.portal.ready' }, window, PORTAL_ORIGIN)
    emit({ v: 1, type: 'voc.portal.ready' }, null, PORTAL_ORIGIN)
    emit({ v: 2, type: 'voc.portal.ready' }, frame.contentWindow)
    expect(post).not.toHaveBeenCalled()

    emit({ v: 1, type: 'voc.portal.ready' }, frame.contentWindow)

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      { v: 1, type: 'voc.portal.auth', token: 'tok-1', expires_at: '2026-11-16T11:00:00.000000Z', locale: 'vi', theme: 'dark' },
      PORTAL_ORIGIN,
    )
  })

  it('never posts with a wildcard target origin', async () => {
    const { el, handle } = await mount()
    const frame = frameIn(el)
    const post = spyPost(frame)

    emit({ v: 1, type: 'voc.portal.ready' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.authenticated' }, frame.contentWindow)
    handle.navigate('/tickets/1')
    handle.setLocale('en')
    emit({ v: 1, type: 'voc.portal.token-expiring' }, frame.contentWindow)
    await flush()

    expect(post.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const call of post.mock.calls) {
      expect(call[1]).toBe(PORTAL_ORIGIN)
      expect(call[1]).not.toBe('*')
    }
  })

  it('fetches a fresh session on token-expiring and re-posts auth', async () => {
    const getSession = vi.fn(async ({ refresh }: { refresh: boolean }) => session(refresh ? 'tok-2' : 'tok-1'))
    const { el } = await mount({ getSession })
    const frame = frameIn(el)
    const post = spyPost(frame)

    emit({ v: 1, type: 'voc.portal.ready' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.authenticated' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.token-expiring' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.token-expiring' }, frame.contentWindow)
    await flush()

    expect(getSession).toHaveBeenCalledTimes(2)
    expect(getSession).toHaveBeenLastCalledWith({ refresh: true })
    expect(post).toHaveBeenLastCalledWith(
      { v: 1, type: 'voc.portal.auth', token: 'tok-2', expires_at: '2026-11-16T11:00:00.000000Z' },
      PORTAL_ORIGIN,
    )
  })

  it('retries auth once after auth_failed, then reports the error', async () => {
    const onError = vi.fn()
    const getSession = vi.fn(async () => session())
    const { el } = await mount({ getSession, onError })
    const frame = frameIn(el)
    spyPost(frame)

    emit({ v: 1, type: 'voc.portal.error', code: 'auth_failed' }, frame.contentWindow)
    await flush()
    expect(getSession).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()

    emit({ v: 1, type: 'voc.portal.error', code: 'auth_failed' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.error', code: 'origin_not_allowed' }, frame.contentWindow)
    expect(onError).toHaveBeenNthCalledWith(1, 'auth_failed', undefined)
    expect(onError).toHaveBeenNthCalledWith(2, 'origin_not_allowed', undefined)
  })

  it('handles resize, navigate and unread messages', async () => {
    const onNavigate = vi.fn()
    const onUnreadChange = vi.fn()
    const { el } = await mount({ onNavigate, onUnreadChange, minHeight: 400 })
    const frame = frameIn(el)

    emit({ v: 1, type: 'voc.portal.resize', height: 1234.2 }, frame.contentWindow)
    expect(frame.style.height).toBe('1235px')
    emit({ v: 1, type: 'voc.portal.resize', height: 10 }, frame.contentWindow)
    expect(frame.style.height).toBe('400px')

    emit({ v: 1, type: 'voc.portal.navigate', route: '/tickets/9' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.navigate', route: 'https://evil.test' }, frame.contentWindow)
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/tickets/9')

    emit({ v: 1, type: 'voc.portal.unread', count: 3 }, frame.contentWindow)
    expect(onUnreadChange).toHaveBeenCalledWith(3)
  })

  it('queues navigate until the portal is authenticated', async () => {
    const { el, handle } = await mount()
    const frame = frameIn(el)
    const post = spyPost(frame)

    handle.navigate('/tickets/7')
    expect(post).not.toHaveBeenCalled()

    emit({ v: 1, type: 'voc.portal.ready' }, frame.contentWindow)
    emit({ v: 1, type: 'voc.portal.authenticated' }, frame.contentWindow)

    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'voc.portal.navigate', route: '/tickets/7' }, PORTAL_ORIGIN)

    handle.navigate('//evil.test/x')
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('accepts camelCase and axios-style session results', async () => {
    const camel = await mount({
      getSession: async () => ({ accessToken: 't', expiresAt: 'e', portalUrl: `${PORTAL_ORIGIN}/portal/`, clientKey: 'vk_c' }),
    })
    expect(frameIn(camel.el).getAttribute('src')).toBe(`${PORTAL_ORIGIN}/portal/tickets?client=vk_c`)

    const axios = await mount({ getSession: async () => ({ data: session('t', { client_key: 'vk_a' }) }) })
    expect(frameIn(axios.el).getAttribute('src')).toBe(`${PORTAL_ORIGIN}/portal/tickets?client=vk_a`)
  })

  it('reports session_failed and mounts nothing when getSession fails', async () => {
    const onError = vi.fn()
    const failure = new Error('403')
    const { el } = await mount({ getSession: async () => Promise.reject(failure), onError })

    expect(el.querySelector('iframe')).toBeNull()
    expect(onError).toHaveBeenCalledWith('session_failed', failure)

    const bad = await mount({ getSession: async () => session('t', { portal_url: 'javascript:alert(1)' }), onError })
    expect(bad.el.querySelector('iframe')).toBeNull()
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('destroy removes the iframe and the message listener', async () => {
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const onUnreadChange = vi.fn()
    const { el, handle } = await mount({ onUnreadChange })
    const frame = frameIn(el)
    const contentWindow = frame.contentWindow

    handle.destroy()
    handle.destroy()

    expect(el.querySelector('iframe')).toBeNull()
    expect(removeListener).toHaveBeenCalledWith('message', expect.any(Function))
    emit({ v: 1, type: 'voc.portal.unread', count: 1 }, contentWindow)
    expect(onUnreadChange).not.toHaveBeenCalled()
  })

  it('does not mount when destroyed before the session resolves', async () => {
    const el = document.createElement('div')
    let resolve: (value: ReturnType<typeof session>) => void = () => undefined
    const handle = mountVocPortal(el, { getSession: () => new Promise((r) => (resolve = r)) })

    handle.destroy()
    resolve(session())
    await flush()

    expect(el.querySelector('iframe')).toBeNull()
  })
})

describe('buildPortalSrc', () => {
  it('appends the route and client key', () => {
    expect(buildPortalSrc('https://voc.test/portal/', '/tickets/new', 'vk 1')).toBe('https://voc.test/portal/tickets/new?client=vk+1')
  })

  it('refuses routes that leave the portal', () => {
    expect(() => buildPortalSrc('https://voc.test/portal', '//evil.test', 'k')).toThrow()
    expect(() => buildPortalSrc('https://voc.test/portal', 'https://evil.test', 'k')).toThrow()
  })
})
