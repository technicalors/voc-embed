/** Portal session as returned by `GET {prefix}/session` of technicalors/voc-laravel. */
export interface VocSession {
  access_token: string
  expires_at: string
  portal_url: string
  client_key: string
  abilities?: string[]
}

/** Same session with camelCase keys, for hosts whose HTTP client converts response keys. */
export interface VocSessionCamel {
  accessToken: string
  expiresAt: string
  portalUrl: string
  clientKey: string
  abilities?: string[]
}

/**
 * What `getSession` may resolve to: the session itself (snake_case or camelCase) or an
 * HTTP client response that carries it in `data` (axios style).
 */
export type VocSessionLike = VocSession | VocSessionCamel | { data: VocSession | VocSessionCamel }

/** Passed to `getSession`. `refresh` is true when the portal asked for a new token; forward it as `?refresh=1`. */
export interface VocSessionRequest {
  refresh: boolean
}

export class VocSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VocSessionError'
  }
}

function pick(source: Record<string, unknown>, snake: string, camel: string): unknown {
  return source[snake] ?? source[camel]
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new VocSessionError(`VOC session is missing ${field}.`)
  }

  return value
}

/** Validates and normalizes a `getSession` result to snake_case. Throws `VocSessionError` when invalid. */
export function normalizeSession(input: unknown): VocSession {
  if (typeof input !== 'object' || input === null) {
    throw new VocSessionError('VOC session must be an object.')
  }

  let source = input as Record<string, unknown>
  if (pick(source, 'access_token', 'accessToken') === undefined && typeof source.data === 'object' && source.data !== null) {
    source = source.data as Record<string, unknown>
  }

  const portalUrl = requireString(pick(source, 'portal_url', 'portalUrl'), 'portal_url')
  let parsed: URL
  try {
    parsed = new URL(portalUrl)
  } catch {
    throw new VocSessionError('VOC session portal_url is not a URL.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new VocSessionError('VOC session portal_url must be http(s).')
  }

  const abilities = source.abilities
  const session: VocSession = {
    access_token: requireString(pick(source, 'access_token', 'accessToken'), 'access_token'),
    expires_at: requireString(pick(source, 'expires_at', 'expiresAt'), 'expires_at'),
    portal_url: portalUrl,
    client_key: requireString(pick(source, 'client_key', 'clientKey'), 'client_key'),
  }

  if (Array.isArray(abilities)) {
    session.abilities = abilities.filter((ability): ability is string => typeof ability === 'string')
  }

  return session
}
