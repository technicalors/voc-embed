/**
 * VOC Integration Protocol v1: postMessage contract between a host page and the VOC portal iframe.
 *
 * This file is self-contained on purpose (no imports) so VOC web can mirror it verbatim.
 * Keep both copies identical.
 */

export const VOC_PROTOCOL_VERSION = 1 as const

export type VocProtocolVersion = typeof VOC_PROTOCOL_VERSION

export const VOC_LOCALES = ['vi', 'en', 'ko'] as const

export type VocLocale = (typeof VOC_LOCALES)[number]

export const VOC_THEMES = ['light', 'dark'] as const

export type VocTheme = (typeof VOC_THEMES)[number]

export const VOC_PORTAL_ERROR_CODES = ['origin_not_allowed', 'auth_failed', 'client_unknown'] as const

export type VocPortalErrorCode = (typeof VOC_PORTAL_ERROR_CODES)[number]

/** Parent -> iframe. Hands the portal a token; answers `voc.portal.ready` and `voc.portal.token-expiring`. */
export interface VocAuthMessage {
  v: VocProtocolVersion
  type: 'voc.portal.auth'
  token: string
  expires_at: string
  locale?: VocLocale
  theme?: VocTheme
}

/** Parent -> iframe. Asks the portal to show a route such as `/tickets/123`. */
export interface VocNavigateCommand {
  v: VocProtocolVersion
  type: 'voc.portal.navigate'
  route: string
}

export type VocParentMessage = VocAuthMessage | VocNavigateCommand

/** Iframe -> parent. The portal loaded and waits for `voc.portal.auth`. */
export interface VocReadyMessage {
  v: VocProtocolVersion
  type: 'voc.portal.ready'
}

/** Iframe -> parent. The token was accepted. */
export interface VocAuthenticatedMessage {
  v: VocProtocolVersion
  type: 'voc.portal.authenticated'
}

/** Iframe -> parent. Sent 5 minutes before `expires_at`; the parent sends a fresh `voc.portal.auth`. */
export interface VocTokenExpiringMessage {
  v: VocProtocolVersion
  type: 'voc.portal.token-expiring'
}

/** Iframe -> parent. The portal route changed. */
export interface VocNavigatedMessage {
  v: VocProtocolVersion
  type: 'voc.portal.navigate'
  route: string
}

/** Iframe -> parent. Content height in pixels. */
export interface VocResizeMessage {
  v: VocProtocolVersion
  type: 'voc.portal.resize'
  height: number
}

/** Iframe -> parent. Unread notification count of the portal user. */
export interface VocUnreadMessage {
  v: VocProtocolVersion
  type: 'voc.portal.unread'
  count: number
}

/** Iframe -> parent. The portal cannot continue. */
export interface VocErrorMessage {
  v: VocProtocolVersion
  type: 'voc.portal.error'
  code: VocPortalErrorCode
}

export type VocPortalMessage =
  | VocReadyMessage
  | VocAuthenticatedMessage
  | VocTokenExpiringMessage
  | VocNavigatedMessage
  | VocResizeMessage
  | VocUnreadMessage
  | VocErrorMessage

export type VocParentMessageType = VocParentMessage['type']

export type VocPortalMessageType = VocPortalMessage['type']

export const VOC_PARENT_MESSAGE_TYPES: readonly VocParentMessageType[] = ['voc.portal.auth', 'voc.portal.navigate']

export const VOC_PORTAL_MESSAGE_TYPES: readonly VocPortalMessageType[] = [
  'voc.portal.ready',
  'voc.portal.authenticated',
  'voc.portal.token-expiring',
  'voc.portal.navigate',
  'voc.portal.resize',
  'voc.portal.unread',
  'voc.portal.error',
]

type Envelope = { v: VocProtocolVersion; type: string } & Record<string, unknown>

function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { v?: unknown }).v === VOC_PROTOCOL_VERSION &&
    typeof (data as { type?: unknown }).type === 'string'
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Route accepted by the portal: an absolute path, never a URL or protocol-relative path. */
export function isVocRoute(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
}

export function isVocLocale(value: unknown): value is VocLocale {
  return typeof value === 'string' && (VOC_LOCALES as readonly string[]).includes(value)
}

export function isVocTheme(value: unknown): value is VocTheme {
  return typeof value === 'string' && (VOC_THEMES as readonly string[]).includes(value)
}

export function isVocPortalErrorCode(value: unknown): value is VocPortalErrorCode {
  return typeof value === 'string' && (VOC_PORTAL_ERROR_CODES as readonly string[]).includes(value)
}

/** Validates a message received by the portal iframe from its parent. */
export function isVocParentMessage(data: unknown): data is VocParentMessage {
  if (!isEnvelope(data)) {
    return false
  }

  switch (data.type) {
    case 'voc.portal.auth':
      return (
        isNonEmptyString(data.token) &&
        isNonEmptyString(data.expires_at) &&
        (data.locale === undefined || isVocLocale(data.locale)) &&
        (data.theme === undefined || isVocTheme(data.theme))
      )
    case 'voc.portal.navigate':
      return isVocRoute(data.route)
    default:
      return false
  }
}

/** Validates a message received by the parent from the portal iframe. */
export function isVocPortalMessage(data: unknown): data is VocPortalMessage {
  if (!isEnvelope(data)) {
    return false
  }

  switch (data.type) {
    case 'voc.portal.ready':
    case 'voc.portal.authenticated':
    case 'voc.portal.token-expiring':
      return true
    case 'voc.portal.navigate':
      return isVocRoute(data.route)
    case 'voc.portal.resize':
      return isNonNegativeNumber(data.height)
    case 'voc.portal.unread':
      return isNonNegativeNumber(data.count) && Number.isInteger(data.count)
    case 'voc.portal.error':
      return isVocPortalErrorCode(data.code)
    default:
      return false
  }
}
