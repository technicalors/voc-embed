import { vi } from 'vitest'
import type { VocSession } from '../src/session'

export const PORTAL_ORIGIN = 'https://voc.test'

export function session(token = 'tok-1', overrides: Partial<VocSession> = {}): VocSession {
  return {
    access_token: token,
    expires_at: '2026-11-16T11:00:00.000000Z',
    portal_url: `${PORTAL_ORIGIN}/portal`,
    client_key: 'vk_obee_1',
    abilities: ['voc.view'],
    ...overrides,
  }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export function frameIn(el: HTMLElement): HTMLIFrameElement {
  const frame = el.querySelector('iframe')
  if (frame === null) {
    throw new Error('iframe not mounted')
  }

  return frame
}

/** Spies on postMessage of the iframe window. */
export function spyPost(frame: HTMLIFrameElement) {
  const target = frame.contentWindow
  if (target === null) {
    throw new Error('iframe has no window')
  }

  return vi.spyOn(target, 'postMessage').mockImplementation(() => undefined)
}

/** Simulates a message coming from `source` at `origin`. */
export function emit(data: unknown, source: MessageEventSource | null, origin = PORTAL_ORIGIN): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}
