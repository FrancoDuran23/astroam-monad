# 11 — A claim collects what was used, not the whole voucher

Found while implementing spec 05. Runs after it.

## Why

The app signs vouchers ahead of usage so data keeps flowing: before a batch
of traffic it authorizes the usage so far plus the next batch and a margin
(`authorizeUpTo` in `frontend/src/hooks/useMission.ts`). A voucher is a
ceiling, not a bill.

`claim(escrowId, voucherAmount, signature)` pays the payee the whole voucher,
and the fund-flow job claims the highest voucher it holds. So a claim can
collect more than the traveler has used. Two things follow:

- The traveler is charged for data not used, and nothing gives it back:
  `close` cannot settle below what was claimed.
- If the trip ends with usage below what was claimed, `close` reverts with
  `SettleBelowClaimed` and the trip cannot be finished.

`close` already has the right shape: it takes the voucher as the ceiling and
a separate `settleAmount`. `claim` gets the same.

Escrow v4 is not deployed yet, so this changes v4 itself; there is no v5.

## Scope

- `contracts/src/AstroAmEscrow.sol`, `contracts/test/AstroAmEscrow.t.sol`,
  `src/shared/monad/abi.ts` (regenerated)
- `src/rails/*`, the claim path in
  `src/product/services/MissionProductService.ts` and
  `src/product/services/fund-flow.ts`, their tests
- `docs/monad-deployments.md` (the v4 entry), `docs/specs/01-escrow-v4-operator.md`
  is left as written

## Requirements

### Contract

1. `claim(bytes32 escrowId, uint256 voucherAmount, bytes signature, uint256 claimTotal)`.
   `claimTotal` is the running total the payee will have been paid after the
   call. It must be above `escrow.claimed` (`NothingToClaim` otherwise) and
   not above `voucherAmount` (`ClaimExceedsVoucher`). The voucher is checked
   as today. The payee is paid `claimTotal - escrow.claimed`, and
   `escrow.claimed` becomes `claimTotal`.
2. `Claimed` keeps its shape: the amount paid and the new total.
3. Update the NatSpec: a voucher is the most the traveler authorizes; a claim
   collects usage up to it. State what remains trusted: the contract cannot
   know the usage, so an operator may claim up to the voucher; what the
   traveler controls is how far ahead of usage the app signs.

### Backend

4. The fund-flow claim collects `min(used, voucher)`, where `used` is the
   mission's metered cost in atomic units, rounded down — the same figure
   `finishMission` settles. A claim is due when that amount exceeds what was
   already claimed by at least `CLAIM_MIN_USDC`.
5. The invariant: what has been claimed never exceeds what has been used.
   With it, `close` at the used amount can never fall below the claimed
   total.
6. If a mission is ever found with claimed above used (state from before
   this change, or a usage figure corrected downward), finishing it must not
   fail: settle at the claimed total, and record in the mission and the log
   that the trip closed above its metered usage and by how much.
7. `FakeRail` follows the new `claim` rules.
8. `recordClaimedOnChain` and the channel locks keep working.

### Intents while the rail cannot settle

9. A deposit must not be invited into an escrow the server cannot settle.
   When the rail's operator check fails (the configured key is neither the
   contract's operator nor its payee), or the rail is not ready,
   `createPaymentIntent` and `createTopUpIntent` refuse with the existing
   "unavailable" error, and `capabilities.paymentsLive` is false, so the app
   shows its "payments are not available" notice. Do not call the RPC on
   every request: cache the result for a short time.

## Tests

- Foundry: claim below the voucher pays exactly the difference and leaves the
  rest claimable with the same voucher; `claimTotal` above the voucher
  reverts; `claimTotal` not above `claimed` reverts; two partial claims on one
  voucher then a close at a higher usage; a close right after a partial claim
  at the same amount needs no new voucher.
- Rail against anvil: voucher for 4 USDC, usage 1 USDC, claim collects 1; the
  payee's balance grew by exactly 1; close at 1.5 pays 0.5 more and refunds
  the rest.
- Product: a voucher signed well ahead of usage, a fund-flow tick, then
  finish with no further usage: the trip closes, the traveler is refunded
  everything not used, the payee received exactly the usage.
- Product: the stuck state from requirement 6 closes and is recorded.
- Product: with an unauthorized operator key, creating an intent fails with
  "unavailable" and capabilities report `paymentsLive: false`.

## Done when

`forge test --root contracts`, `npm run check` and `npm test` pass with no
failing and no skipped test, and the ABI drift test passes against a fresh
`npm run contracts:build`.
