import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRefundError, refundAvailability, refundFailureMessage, RefundFailure, type EscrowSnapshot } from './refundWindow.ts'

const DAY = 86_400n
const escrow: EscrowSnapshot = {
  traveler: '0x1111111111111111111111111111111111111111',
  settled: false,
  deposit: 10_000_000n,
  claimed: 2_500_000n,
  lastActivityAt: 1_000_000n,
  timeoutSeconds: 30n * DAY,
}
const deadline = Number(escrow.lastActivityAt + escrow.timeoutSeconds)

describe('refundAvailability', () => {
  it('reports not available yet, with the date and the amount', () => {
    const result = refundAvailability(escrow, deadline - 1)
    assert.deepEqual(result, { kind: 'not-yet', availableAt: deadline, amountAtomic: 7_500_000n })
  })

  it('is available exactly at lastActivityAt + timeoutSeconds, as the contract allows', () => {
    assert.deepEqual(refundAvailability(escrow, deadline), { kind: 'available', amountAtomic: 7_500_000n })
  })

  it('is available after the timeout and returns deposit minus claimed', () => {
    assert.deepEqual(refundAvailability(escrow, deadline + 3600), { kind: 'available', amountAtomic: 7_500_000n })
  })

  it('reports nothing to withdraw when everything was claimed', () => {
    assert.deepEqual(refundAvailability({ ...escrow, claimed: escrow.deposit }, deadline + 1), { kind: 'nothing' })
  })

  it('reports an escrow that is already settled, even after the timeout', () => {
    assert.deepEqual(refundAvailability({ ...escrow, settled: true }, deadline + 1), { kind: 'settled' })
  })

  it('reports an escrow the contract does not know', () => {
    const zero = '0x0000000000000000000000000000000000000000'
    assert.deepEqual(refundAvailability({ ...escrow, traveler: zero, deposit: 0n, claimed: 0n }, deadline), { kind: 'missing' })
  })

  it('ignores fractions of a second in the clock', () => {
    assert.equal(refundAvailability(escrow, deadline + 0.9).kind, 'available')
    assert.equal(refundAvailability(escrow, deadline - 0.1).kind, 'not-yet')
  })
})

describe('classifyRefundError', () => {
  it('recognizes a rejection in the wallet', () => {
    assert.equal(classifyRefundError({ code: 4001, message: 'User rejected the request.' }), 'rejected')
    assert.equal(classifyRefundError({ message: 'x', cause: { code: 4001 } }), 'rejected')
  })

  it('recognizes the contract reverts through the cause chain', () => {
    assert.equal(classifyRefundError({ message: 'reverted', cause: { data: { errorName: 'TimeoutNotReached' } } }), 'timeout')
    assert.equal(classifyRefundError({ shortMessage: 'The contract function "refund" reverted with AlreadySettled()' }), 'settled')
    assert.equal(classifyRefundError({ cause: { data: { errorName: 'EscrowMissing' } } }), 'missing')
  })

  it('recognizes a wallet without gas and a wrong network', () => {
    assert.equal(classifyRefundError(new Error('The total cost of executing this transaction exceeds the balance of the account.')), 'no-gas')
    assert.equal(classifyRefundError({ name: 'ChainMismatchError', message: 'x' }), 'wrong-network')
  })

  it('keeps the kind of a RefundFailure and falls back to other', () => {
    assert.equal(classifyRefundError(new RefundFailure('no-gas', 'x')), 'no-gas')
    assert.equal(classifyRefundError(new Error('boom')), 'other')
    assert.equal(classifyRefundError(undefined), 'other')
  })
})

describe('refundFailureMessage', () => {
  it('names the date when the timeout has not been reached', () => {
    const message = refundFailureMessage('timeout', { chainName: 'Monad Testnet', availableAt: deadline })
    assert.match(message, /timeout has not been reached yet\. You can withdraw from .*\d{4}/)
  })

  it('names the network when the wallet has no gas', () => {
    assert.match(refundFailureMessage('no-gas', { chainName: 'Monad Testnet' }), /no MON for gas on Monad Testnet/)
  })
})
