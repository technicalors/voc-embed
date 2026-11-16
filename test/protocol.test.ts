import { describe, expect, it } from 'vitest'
import { isVocParentMessage, isVocPortalMessage, isVocRoute } from '../src/protocol'

describe('protocol guards', () => {
  it('accepts valid portal messages', () => {
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.ready' })).toBe(true)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.resize', height: 800 })).toBe(true)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.unread', count: 0 })).toBe(true)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.error', code: 'client_unknown' })).toBe(true)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.navigate', route: '/tickets/1' })).toBe(true)
  })

  it('rejects malformed or foreign messages', () => {
    expect(isVocPortalMessage(null)).toBe(false)
    expect(isVocPortalMessage('voc.portal.ready')).toBe(false)
    expect(isVocPortalMessage({ type: 'voc.portal.ready' })).toBe(false)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.auth', token: 't', expires_at: 'e' })).toBe(false)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.resize', height: -1 })).toBe(false)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.unread', count: 1.5 })).toBe(false)
    expect(isVocPortalMessage({ v: 1, type: 'voc.portal.error', code: 'boom' })).toBe(false)
  })

  it('validates parent messages', () => {
    expect(isVocParentMessage({ v: 1, type: 'voc.portal.auth', token: 't', expires_at: 'e', locale: 'ko', theme: 'light' })).toBe(true)
    expect(isVocParentMessage({ v: 1, type: 'voc.portal.auth', token: 't', expires_at: 'e', locale: 'fr' })).toBe(false)
    expect(isVocParentMessage({ v: 1, type: 'voc.portal.auth', token: '', expires_at: 'e' })).toBe(false)
    expect(isVocParentMessage({ v: 1, type: 'voc.portal.navigate', route: '/notifications' })).toBe(true)
    expect(isVocParentMessage({ v: 1, type: 'voc.portal.ready' })).toBe(false)
  })

  it('only accepts same-origin absolute routes', () => {
    expect(isVocRoute('/tickets/1/edit')).toBe(true)
    expect(isVocRoute('tickets')).toBe(false)
    expect(isVocRoute('//evil.test')).toBe(false)
    expect(isVocRoute('/\\evil.test')).toBe(false)
  })
})
