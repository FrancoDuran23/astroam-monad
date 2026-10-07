import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  sessionStorageKey,
  sessionKeyStorageKey,
  hasSessionKey,
  shouldWarnMissingSessionKey,
  MISSING_SESSION_KEY_WARNING,
} from '../chain/monad.ts'

describe('sessionKey storage and helpers', () => {
  const originalLocalStorage = globalThis.localStorage
  let mockStore: Map<string, string>

  beforeEach(() => {
    mockStore = new Map<string, string>()
    globalThis.localStorage = {
      getItem: (key: string) => mockStore.get(key) ?? null,
      setItem: (key: string, val: string) => mockStore.set(key, String(val)),
      removeItem: (key: string) => {
        mockStore.delete(key)
      },
      clear: () => mockStore.clear(),
      key: (idx: number) => Array.from(mockStore.keys())[idx] ?? null,
      get length() {
        return mockStore.size
      },
    } as unknown as Storage
  })

  afterEach(() => {
    if (originalLocalStorage !== undefined) {
      globalThis.localStorage = originalLocalStorage
    } else {
      // @ts-expect-error restore undefined environment in node
      delete globalThis.localStorage
    }
  })

  it('generates the expected storage key format', () => {
    assert.equal(sessionStorageKey('test-mission-123'), 'astroam_session_test-mission-123')
    assert.equal(sessionKeyStorageKey('test-mission-123'), 'astroam_session_test-mission-123')
    assert.equal(sessionKeyStorageKey, sessionStorageKey)
  })

  it('returns false when session key is not present in localStorage', () => {
    assert.equal(hasSessionKey('mission-abc'), false)
  })

  it('returns false when localStorage has invalid JSON', () => {
    mockStore.set('astroam_session_mission-invalid', 'not-valid-json{')
    assert.equal(hasSessionKey('mission-invalid'), false)
  })

  it('returns false when localStorage entry is missing privateKey', () => {
    mockStore.set('astroam_session_mission-no-key', JSON.stringify({ contract: '0x123' }))
    assert.equal(hasSessionKey('mission-no-key'), false)
  })

  it('returns true when valid session record with privateKey exists', () => {
    mockStore.set(
      'astroam_session_mission-valid',
      JSON.stringify({
        privateKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        escrowId: '0x1111',
      }),
    )
    assert.equal(hasSessionKey('mission-valid'), true)
  })

  it('returns false after session key is removed from localStorage', () => {
    const missionId = 'mission-to-clear'
    mockStore.set(
      sessionKeyStorageKey(missionId),
      JSON.stringify({ privateKey: '0x123456' }),
    )
    assert.equal(hasSessionKey(missionId), true)

    localStorage.removeItem(sessionKeyStorageKey(missionId))
    assert.equal(hasSessionKey(missionId), false)
  })
})

describe('shouldWarnMissingSessionKey helper', () => {
  it('does not warn when session key is present', () => {
    const warn = shouldWarnMissingSessionKey({
      hasKey: true,
      travelerSigns: true,
      network: 'monad:testnet',
      isCompleted: false,
    })
    assert.equal(warn, false)
  })

  it('does not warn in demo mode even if key is missing', () => {
    const warn = shouldWarnMissingSessionKey({
      hasKey: false,
      isDemoMode: true,
      travelerSigns: false,
      network: 'demo:local',
    })
    assert.equal(warn, false)
  })

  it('does not warn when mission is completed or cancelled', () => {
    assert.equal(
      shouldWarnMissingSessionKey({
        hasKey: false,
        isCompleted: true,
        travelerSigns: true,
        network: 'monad:testnet',
      }),
      false,
    )
    assert.equal(
      shouldWarnMissingSessionKey({
        hasKey: false,
        status: 'completed',
        travelerSigns: true,
        network: 'monad:testnet',
      }),
      false,
    )
    assert.equal(
      shouldWarnMissingSessionKey({
        hasKey: false,
        status: 'cancelled',
        travelerSigns: true,
        network: 'monad:testnet',
      }),
      false,
    )
    assert.equal(
      shouldWarnMissingSessionKey({
        hasKey: false,
        status: 'pending_payment',
        travelerSigns: true,
        network: 'monad:testnet',
      }),
      false,
    )
  })

  it('does not warn when the rail does not require traveler signing', () => {
    const warn = shouldWarnMissingSessionKey({
      hasKey: false,
      travelerSigns: false,
      network: 'solana:devnet',
    })
    assert.equal(warn, false)
  })

  it('warns when key is missing on an active mission with travelerSigns=true', () => {
    const warn = shouldWarnMissingSessionKey({
      hasKey: false,
      isDemoMode: false,
      isCompleted: false,
      status: 'active',
      travelerSigns: true,
      network: 'monad:testnet',
    })
    assert.equal(warn, true)
  })

  it('warns when key is missing on an active Monad network mission', () => {
    const warn = shouldWarnMissingSessionKey({
      hasKey: false,
      isDemoMode: false,
      isCompleted: false,
      status: 'active',
      travelerSigns: false,
      network: 'monad:testnet',
    })
    assert.equal(warn, true)
  })

  it('has exact required warning message text', () => {
    assert.equal(
      MISSING_SESSION_KEY_WARNING,
      'Session key not found in this browser. You cannot authorize new data usage on this device; only usage up to the last signed voucher will be billed.',
    )
  })
})
