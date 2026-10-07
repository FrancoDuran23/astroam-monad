import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Request, Response } from 'express'
import { isWildcardOrigin, resolveAllowedOrigin, corsMiddleware } from './cors.ts'

test('isWildcardOrigin identifies wildcards correctly', () => {
  assert.equal(isWildcardOrigin(undefined), true)
  assert.equal(isWildcardOrigin(''), true)
  assert.equal(isWildcardOrigin('   '), true)
  assert.equal(isWildcardOrigin('*'), true)
  assert.equal(isWildcardOrigin('http://localhost:5173'), false)
  assert.equal(isWildcardOrigin('http://localhost:5173, http://192.168.1.50:5173'), false)
  assert.equal(isWildcardOrigin('http://localhost:5173, *'), true)
})

test('resolveAllowedOrigin with wildcard or unset configuration', () => {
  assert.equal(resolveAllowedOrigin(undefined, 'http://example.com'), '*')
  assert.equal(resolveAllowedOrigin('*', 'http://example.com'), '*')
  assert.equal(resolveAllowedOrigin('  *  ', undefined), '*')
})

test('resolveAllowedOrigin with single origin', () => {
  const config = 'http://localhost:5173'
  assert.equal(resolveAllowedOrigin(config, 'http://localhost:5173'), 'http://localhost:5173')
  assert.equal(resolveAllowedOrigin(config, 'http://localhost:5173/'), 'http://localhost:5173/')
  assert.equal(resolveAllowedOrigin(config, undefined), 'http://localhost:5173')
  assert.equal(resolveAllowedOrigin(config, 'http://other.com'), null)
})

test('resolveAllowedOrigin with comma-separated origins (LAN + localhost)', () => {
  const config = 'http://localhost:5173, http://192.168.1.105:5173, https://app.example.com'
  assert.equal(resolveAllowedOrigin(config, 'http://localhost:5173'), 'http://localhost:5173')
  assert.equal(resolveAllowedOrigin(config, 'http://192.168.1.105:5173'), 'http://192.168.1.105:5173')
  assert.equal(resolveAllowedOrigin(config, 'https://app.example.com'), 'https://app.example.com')
  assert.equal(resolveAllowedOrigin(config, undefined), 'http://localhost:5173')
  assert.equal(resolveAllowedOrigin(config, 'http://unauthorized.org'), null)
})

test('corsMiddleware sets headers and handles OPTIONS preflight', () => {
  const oldEnv = process.env.FRONTEND_ORIGIN
  try {
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173,http://192.168.1.50:5173'

    const headers: Record<string, string> = {}
    let statusSent: number | null = null
    let nextCalled = false

    const mockReq = {
      method: 'OPTIONS',
      headers: { origin: 'http://192.168.1.50:5173' },
    } as unknown as Request

    const mockRes = {
      setHeader(name: string, value: string) {
        headers[name] = value
      },
      sendStatus(code: number) {
        statusSent = code
      },
    } as unknown as Response

    corsMiddleware(mockReq, mockRes, () => {
      nextCalled = true
    })

    assert.equal(headers['Access-Control-Allow-Origin'], 'http://192.168.1.50:5173')
    assert.equal(headers['Vary'], 'Origin')
    assert.equal(headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS')
    assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization')
    assert.equal(statusSent, 204)
    assert.equal(nextCalled, false)

    // Non-OPTIONS call calls next()
    const getReq = {
      method: 'GET',
      headers: { origin: 'http://localhost:5173' },
    } as unknown as Request

    corsMiddleware(getReq, mockRes, () => {
      nextCalled = true
    })

    assert.equal(headers['Access-Control-Allow-Origin'], 'http://localhost:5173')
    assert.equal(nextCalled, true)
  } finally {
    if (oldEnv !== undefined) {
      process.env.FRONTEND_ORIGIN = oldEnv
    } else {
      delete process.env.FRONTEND_ORIGIN
    }
  }
})
