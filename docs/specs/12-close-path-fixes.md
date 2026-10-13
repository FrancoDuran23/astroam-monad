# 12 — Three fixes in how a trip closes

Found while implementing specs 05 and 11. Runs after spec 11, before spec 06.

## Scope

- `src/product/services/fund-flow.ts`
- `src/product/services/MissionProductService.ts`
- Their tests under `src/product/` and `src/jobs/`

No contract, rail or frontend change.

## Requirements

### 1. "Deposit spent" means the usage reached the deposit

`autoCloseReason` returns `deposit_spent` when the highest voucher reaches the
deposit. A voucher is a ceiling signed ahead of usage, and the app caps it at
the budget, so near the end of the balance the traveler's app signs a voucher
equal to the deposit and the trip is closed with balance still unused.

Return `deposit_spent` when the usage reaches the deposit: the same `used`
figure the claim and the close settle (`usedAtomic` in
`MissionProductService`). `autoCloseReason` is a pure function in
`fund-flow.ts`; pass the used amount in rather than recomputing it there.

### 2. The eSIM wallet is defunded after the close lands, not before

`closeWithVoucher` calls `connectivity.refundUnused` first and closes the
escrow second. If the close then fails, the trip is still open with its eSIM
wallet emptied.

Close first. Call `refundUnused` only once the escrow is known to be closed
(the close succeeded, or the chain reports it settled). A failure of
`refundUnused` still does not fail the close, as today. Check
`finishMissionLocked` and `cancelMissionLocked` for the same order and fix
them the same way.

### 3. Finishing a trip twice, or after a crash, ends in the same state

`closeWithVoucher` already handles a channel the chain reports as settled.
`finishMissionLocked` does not: if the server stopped between the on-chain
close and saving the mission, the mission stays recorded as open and every
later finish fails with "already settled".

- When the close fails and the chain reports the escrow settled, record the
  trip as completed from the chain's figures (what the payee was paid, what
  was refunded), without a close transaction hash, and return the normal
  result.
- Calling finish on a mission already recorded as completed returns that
  same result and sends nothing.
- Use one shared path for `finishMissionLocked` and `closeWithVoucher`
  rather than two copies of the reconciliation.

## Tests

- `autoCloseReason`: a voucher equal to the deposit with usage below it does
  not close; usage equal to the deposit does.
- A product-level test of the same: a voucher signed up to the full budget
  with little usage, a fund-flow tick, the trip stays open.
- A close that fails leaves the eSIM funded (`refundUnused` not called); a
  close that succeeds calls it once.
- Finish, then finish again: one close transaction, the same result twice.
- The crash case: the rail closes the channel but the save is made to fail;
  a later finish completes the mission from the chain state.

Each test must fail on the code before the change.

## Done when

`npm run check` and `npm test` pass with no failing and no skipped test.
