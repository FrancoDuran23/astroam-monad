import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { paymentMode, showDemoTraffic } from './paymentMode.ts'

const live = { paymentsLive: true }
const notLive = { paymentsLive: false }
const evmIntent = { evm: { chainId: 10143 } }

describe('paymentMode', () => {
  it('is simulated in demo mode whatever the server says', () => {
    assert.equal(paymentMode(true, null), 'simulated')
    assert.equal(paymentMode(true, notLive, {}), 'simulated')
    assert.equal(paymentMode(true, live, evmIntent), 'simulated')
  })

  it('is blocked outside demo mode when payments are not live', () => {
    assert.equal(paymentMode(false, notLive), 'blocked')
    assert.equal(paymentMode(false, notLive, evmIntent), 'blocked')
  })

  it('is blocked outside demo mode when the capabilities are unknown', () => {
    assert.equal(paymentMode(false, null), 'blocked')
    assert.equal(paymentMode(false, undefined, evmIntent), 'blocked')
  })

  it('is blocked outside demo mode when the intent has no evm block', () => {
    assert.equal(paymentMode(false, live, {}), 'blocked')
  })

  it('is on chain only with live payments and an evm plan', () => {
    assert.equal(paymentMode(false, live, evmIntent), 'on-chain')
    assert.equal(paymentMode(false, live), 'on-chain')
  })
})

describe('showDemoTraffic', () => {
  it('shows the button in demo mode', () => {
    assert.equal(showDemoTraffic(true, null), true)
    assert.equal(showDemoTraffic(true, { demoTrafficEnabled: false }), true)
  })

  it('follows the server outside demo mode', () => {
    assert.equal(showDemoTraffic(false, { demoTrafficEnabled: false }), false)
    assert.equal(showDemoTraffic(false, { demoTrafficEnabled: true }), true)
  })

  it('shows the button while capabilities are unknown', () => {
    assert.equal(showDemoTraffic(false, null), true)
  })
})
