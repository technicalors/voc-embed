import {
  type VocAuthMessage,
  type VocLocale,
  type VocParentMessage,
  type VocPortalErrorCode,
  type VocPortalMessage,
  type VocTheme,
  VOC_PROTOCOL_VERSION,
  isVocLocale,
  isVocPortalMessage,
  isVocRoute,
} from './protocol'
import { type VocSession, type VocSessionLike, type VocSessionRequest, normalizeSession } from './session'

/** Portal error codes plus `session_failed`, raised by this package when `getSession` rejects or returns garbage. */
export type VocEmbedErrorCode = VocPortalErrorCode | 'session_failed'

export interface VocPortalOptions {
  /** Fetches a session from the host backend (`GET /api/voc/session`). Called again when the token is about to expire. */
  getSession: (request: VocSessionRequest) => Promise<VocSessionLike>
  /** Initial portal route. Default `/tickets`. */
  route?: string
  /** `vi`, `en` or `ko`; regional tags such as `vi-VN` are reduced to the language. Others are not sent. */
  locale?: string
  theme?: VocTheme
  /** Minimum iframe height in pixels. Default 600. */
  minHeight?: number
  /** Accessible iframe title. Default `VOC`. */
  title?: string
  onNavigate?(route: string): void
  onUnreadChange?(count: number): void
  onError?(code: VocEmbedErrorCode, cause?: unknown): void
}

export interface VocPortalHandle {
  /** Shows a portal route such as `/tickets/123`. Queued until the portal is authenticated. */
  navigate(route: string): void
  setLocale(locale: string): void
  setTheme(theme: VocTheme): void
  /** Changes the minimum iframe height, for example when the host container is resized. */
  setMinHeight(minHeight: number): void
  /** Removes the iframe and the message listener. Safe to call more than once. */
  destroy(): void
}

export const DEFAULT_ROUTE = '/tickets'

export const DEFAULT_MIN_HEIGHT = 600

export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'

/** Reduces a locale to one the portal supports, or undefined. */
export function toVocLocale(locale: string | undefined): VocLocale | undefined {
  if (locale === undefined) {
    return undefined
  }

  const language = locale.trim().toLowerCase().split(/[-_]/)[0]

  return isVocLocale(language) ? language : undefined
}

/** `portal_url + route + ?client=client_key`, refusing routes that would leave the portal origin. */
export function buildPortalSrc(portalUrl: string, route: string, clientKey: string): string {
  if (!isVocRoute(route)) {
    throw new Error(`Invalid VOC portal route: ${route}`)
  }

  const base = portalUrl.replace(/\/+$/, '')
  const url = new URL(base + route)
  if (url.origin !== new URL(portalUrl).origin) {
    throw new Error(`Invalid VOC portal route: ${route}`)
  }

  url.searchParams.set('client', clientKey)

  return url.toString()
}

/**
 * Mounts the VOC portal into `el`: fetches a session, creates the iframe and answers the
 * postMessage handshake. Messages are only accepted from the iframe window at the portal
 * origin and only posted to that origin.
 */
export function mountVocPortal(el: HTMLElement, options: VocPortalOptions): VocPortalHandle {
  let minHeight = Math.max(0, options.minHeight ?? DEFAULT_MIN_HEIGHT)
  let contentHeight = 0
  let initialRoute = isVocRoute(options.route) ? options.route : DEFAULT_ROUTE
  let locale = toVocLocale(options.locale)
  let theme = options.theme
  let session: VocSession | null = null
  let portalOrigin: string | null = null
  let iframe: HTMLIFrameElement | null = null
  let authenticated = false
  let pendingRoute: string | null = null
  let refreshing: Promise<void> | null = null
  let retriedAuth = false
  let destroyed = false

  const applyHeight = (): void => {
    if (iframe !== null) {
      iframe.style.height = `${Math.max(minHeight, contentHeight)}px`
    }
  }

  const fail = (code: VocEmbedErrorCode, cause?: unknown): void => {
    if (!destroyed) {
      options.onError?.(code, cause)
    }
  }

  const post = (message: VocParentMessage): void => {
    if (iframe?.contentWindow && portalOrigin !== null) {
      iframe.contentWindow.postMessage(message, portalOrigin)
    }
  }

  const postAuth = (): void => {
    if (session === null) {
      return
    }

    const message: VocAuthMessage = {
      v: VOC_PROTOCOL_VERSION,
      type: 'voc.portal.auth',
      token: session.access_token,
      expires_at: session.expires_at,
    }
    if (locale !== undefined) {
      message.locale = locale
    }
    if (theme !== undefined) {
      message.theme = theme
    }

    post(message)
  }

  const fetchSession = async (refresh: boolean): Promise<VocSession> => normalizeSession(await options.getSession({ refresh }))

  const refresh = (): Promise<void> => {
    refreshing ??= fetchSession(true)
      .then((fresh) => {
        if (destroyed) {
          return
        }
        if (new URL(fresh.portal_url).origin !== portalOrigin) {
          throw new Error('VOC portal origin changed; remount the portal.')
        }
        session = fresh
        postAuth()
      })
      .catch((error: unknown) => fail('session_failed', error))
      .finally(() => {
        refreshing = null
      })

    return refreshing
  }

  const handle = (message: VocPortalMessage): void => {
    switch (message.type) {
      case 'voc.portal.ready':
        authenticated = false
        postAuth()
        break
      case 'voc.portal.authenticated':
        authenticated = true
        retriedAuth = false
        if (pendingRoute !== null) {
          post({ v: VOC_PROTOCOL_VERSION, type: 'voc.portal.navigate', route: pendingRoute })
          pendingRoute = null
        }
        break
      case 'voc.portal.token-expiring':
        void refresh()
        break
      case 'voc.portal.navigate':
        options.onNavigate?.(message.route)
        break
      case 'voc.portal.resize':
        contentHeight = Math.ceil(message.height)
        applyHeight()
        break
      case 'voc.portal.unread':
        options.onUnreadChange?.(message.count)
        break
      case 'voc.portal.error':
        if (message.code === 'auth_failed' && !retriedAuth) {
          retriedAuth = true
          void refresh()
        } else {
          fail(message.code)
        }
        break
    }
  }

  const onMessage = (event: MessageEvent): void => {
    if (iframe === null || event.source !== iframe.contentWindow || event.origin !== portalOrigin) {
      return
    }
    if (!isVocPortalMessage(event.data)) {
      return
    }

    handle(event.data)
  }

  const start = async (): Promise<void> => {
    let src: string
    try {
      session = await fetchSession(false)
      portalOrigin = new URL(session.portal_url).origin
      src = buildPortalSrc(session.portal_url, initialRoute, session.client_key)
    } catch (error) {
      fail('session_failed', error)

      return
    }

    if (destroyed) {
      return
    }

    const frame = el.ownerDocument.createElement('iframe')
    frame.setAttribute('sandbox', IFRAME_SANDBOX)
    frame.setAttribute('allow', 'clipboard-write')
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    frame.setAttribute('title', options.title ?? 'VOC')
    frame.style.display = 'block'
    frame.style.width = '100%'
    frame.style.border = '0'
    frame.style.height = `${minHeight}px`

    iframe = frame
    window.addEventListener('message', onMessage)
    frame.src = src
    el.appendChild(frame)
  }

  void start()

  return {
    setMinHeight(next: number): void {
      if (destroyed || !Number.isFinite(next)) {
        return
      }
      minHeight = Math.max(0, Math.floor(next))
      applyHeight()
    },
    navigate(route: string): void {
      if (destroyed || !isVocRoute(route)) {
        return
      }
      if (iframe === null) {
        initialRoute = route
      } else if (authenticated) {
        post({ v: VOC_PROTOCOL_VERSION, type: 'voc.portal.navigate', route })
      } else {
        pendingRoute = route
      }
    },
    setLocale(next: string): void {
      const normalized = toVocLocale(next)
      if (destroyed || normalized === undefined || normalized === locale) {
        return
      }
      locale = normalized
      if (authenticated) {
        postAuth()
      }
    },
    setTheme(next: VocTheme): void {
      if (destroyed || next === theme) {
        return
      }
      theme = next
      if (authenticated) {
        postAuth()
      }
    },
    destroy(): void {
      if (destroyed) {
        return
      }
      destroyed = true
      window.removeEventListener('message', onMessage)
      iframe?.remove()
      iframe = null
      session = null
      pendingRoute = null
    },
  }
}
