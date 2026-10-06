import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ResellerInsufficientFundsError,
  getMinRequiredResellerBalanceUsd,
  assertSufficientResellerBalance,
} from './reseller-balance-guard.ts'
import { FakeProvider } from '../providers/connectivity/FakeProvider.ts'

test('getMinRequiredResellerBalanceUsd returns default $4.25 when env vars are unset', () => {
  const origProvision = process.env.CITRUS_ESIM_PROVISION_CENTS
  const origTranche = process.env.FUNDING_TRANCHE_CENTS
  delete process.env.CITRUS_ESIM_PROVISION_CENTS
  delete process.env.FUNDING_TRANCHE_CENTS

  try {
    const required = getMinRequiredResellerBalanceUsd()
    assert.equal(required, 4.25)
  } finally {
    if (origProvision !== undefined) process.env.CITRUS_ESIM_PROVISION_CENTS = origProvision
    if (origTranche !== undefined) process.env.FUNDING_TRANCHE_CENTS = origTranche
  }
})

test('getMinRequiredResellerBalanceUsd respects custom env vars', () => {
  const origProvision = process.env.CITRUS_ESIM_PROVISION_CENTS
  const origTranche = process.env.FUNDING_TRANCHE_CENTS

  process.env.CITRUS_ESIM_PROVISION_CENTS = '200'
  process.env.FUNDING_TRANCHE_CENTS = '300'

  try {
    const required = getMinRequiredResellerBalanceUsd()
    assert.equal(required, 5.0)
  } finally {
    if (origProvision !== undefined) process.env.CITRUS_ESIM_PROVISION_CENTS = origProvision
    else delete process.env.CITRUS_ESIM_PROVISION_CENTS
    if (origTranche !== undefined) process.env.FUNDING_TRANCHE_CENTS = origTranche
    else delete process.env.FUNDING_TRANCHE_CENTS
  }
})

test('assertSufficientResellerBalance succeeds when provider balance >= required', async () => {
  const fakeProvider = new FakeProvider()
  fakeProvider.setResellerBalanceUsd(10.0)

  const result = await assertSufficientResellerBalance(fakeProvider)
  assert.equal(result.balanceUsd, 10.0)
  assert.equal(result.requiredUsd, 4.25)
})

test('assertSufficientResellerBalance throws ResellerInsufficientFundsError when provider balance < required', async () => {
  const fakeProvider = new FakeProvider()
  fakeProvider.setResellerBalanceUsd(2.5)

  await assert.rejects(
    async () => {
      await assertSufficientResellerBalance(fakeProvider)
    },
    (err: unknown) => {
      assert.ok(err instanceof ResellerInsufficientFundsError)
      assert.equal(err.code, 'RESELLER_INSUFFICIENT_FUNDS')
      assert.equal(err.statusCode, 503)
      assert.equal(err.balanceUsd, 2.5)
      assert.equal(err.requiredUsd, 4.25)
      assert.ok(err.message.includes('RESELLER_INSUFFICIENT_FUNDS'))
      return true
    },
  )
})
