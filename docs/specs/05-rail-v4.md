# 05 — Rail for escrow v4

Depends on spec 01 (contract and ABI).

## Why

Three problems in `src/rails/`:

- The rail signs with the payee key, which v4 no longer needs on the server.
- Deposit intents live in a `Map` in memory. If the server restarts between
  creating an intent and confirming it, confirmation fails with
  `unknown_intent` and the mission is marked failed, although the traveler
  paid.
- `FakeRail` accepts claims and settlements the contract would reject, so
  tests on the fake can pass for behaviour that fails on chain.

## Scope

- `src/rails/*`
- The parts of `src/product/services/MissionProductService.ts`,
  `src/jobs/fund-flow.ts`, `src/product/services/fund-flow.ts` and
  `src/server/main.ts` that deal with confirmation, the treasury sweep and
  the rail's key
- `.env.example`, `scripts/close-escrow.ts`
- Tests for all of the above

## Requirements

### Operator key

1. The rail takes `operatorPrivateKey`. The environment variable is
   `MONAD_OPERATOR_PRIVATE_KEY`. If only `MONAD_PAYEE_PRIVATE_KEY` is set,
   fail at start with a message that names the new variable.
2. The rail exposes a check that reads `operator()` and `payee()` from the
   contract and reports whether the configured key is allowed to claim and
   close. `/ready` reports not ready when it is not.
3. Funds are never held by the server key. Remove `sweep` from the rail, from
   `PaymentRail`, from the fund-flow job and from configuration, with its
   tests and its environment variables.
4. No support for v3 remains.

### Deposit confirmation without memory

5. `confirmDeposit` no longer needs a stored intent. For a mission deposit
   the escrow id is `escrowIdForMission(missionId)`; for a top-up it is the
   mission's channel id, supplied by the caller from the mission record.
6. A confirmation is valid when the transaction succeeded and emitted, from
   the configured escrow contract, `Deposited` (mission) or `ToppedUp`
   (top-up) for that escrow id. The amount credited is the one on chain.
7. Confirming the same transaction twice credits once, including across a
   restart. Derive the credit from the escrow's on-chain `deposit` total, or
   persist the used transaction hashes with the mission; do not rely on
   process memory.
8. A transaction for another mission's escrow, from another contract, or a
   reverted one is rejected with the existing reasons.
9. `createDepositIntent` keeps returning what the frontend needs. The intent
   id may remain as a label; nothing depends on remembering it.

### FakeRail follows the contract

10. `FakeRail` rejects what `AstroAmEscrow` rejects: a voucher above the
    deposit, a claim not above what was already claimed, a settlement above
    the highest voucher or below what was claimed, any operation on a settled
    channel. Where the fake is given vouchers with signatures, it verifies
    them against the channel's session key.

### Tests

11. `src/rails/MonadRail.anvil.test.ts` deploys v4 with three distinct
    accounts (traveler, operator, payee). Replace the failing
    "claim() pulls tranche on-chain… sweep()…" test with one that asserts the
    payee's balance grew by exactly what was claimed and settled, and the
    operator's USDC balance stayed at zero. Assert balance changes, never
    absolute balances.
12. A test that creates an intent, builds a new rail instance (a restart) and
    confirms the deposit successfully.
13. A test that the same top-up transaction confirmed twice credits once,
    with a new rail instance in between.
14. A test that a rail configured with a key that is neither operator nor
    payee reports not ready.
15. Tests for each `FakeRail` rejection in requirement 10.

## Done when

`npm run check`, `npm test` and `forge test --root contracts` pass with
Foundry installed, with no failing and no skipped test.
`grep -rn "sweep\|MONAD_PAYEE_PRIVATE_KEY" src scripts .env.example` returns
only the start-up message from requirement 1.
