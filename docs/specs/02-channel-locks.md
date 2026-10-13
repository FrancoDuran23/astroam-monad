# 02 — Channel locks on mission operations

## Why

`MissionProductService` loads a mission, changes it and saves it. The usage
loop, the fund-flow job and HTTP requests all do this for the same mission.
`submitVoucher`, `settleMission`, `advance` and the funding step in
`activateMission` already run inside `locks.withChannelLock`; four operations
do not, so two of them interleaving can lose an update or apply one twice.

astroam-solana locks all of them (`pauseLocked`, `resumeLocked`,
`confirmTopUpLocked`, `meterDemoTraffic` in its
`src/product/services/MissionProductService.ts`).

## Scope

- `src/product/services/MissionProductService.ts`
- Tests next to it under `src/product/`

Nothing under `src/rails/` or `src/meter/`.

## Requirements

1. `pauseMission`, `resumeMission`, `confirmTopUpPayment` and
   `processDemoTraffic` run their load-change-save inside
   `withChannelLock(missionId, …)`.
2. Check `finishMission`, `cancelMission` and `confirmPayment` the same way.
   Lock each one that reads and writes mission state without holding the lock
   for the whole read-change-write. Where one of them calls a method that
   already takes the lock, restructure into a public method that takes the
   lock and a private `…Locked` method that assumes it, as astroam-solana
   does. The lock is not reentrant: a nested acquire deadlocks.
3. A top-up confirmed twice with the same transaction credits once. If that
   already holds, pin it with a test; if it does not, fix it.
4. When the fund-flow claim is due but the rail reports the channel's claimed
   total already covers the voucher, record the claim instead of sending it
   again (astroam-solana test: "a claim that landed but was not recorded is
   not sent twice" in `src/product/fund-flow.test.ts`). If that already
   holds, pin it with a test.

## Tests

- Two concurrent `confirmTopUpPayment` calls for the same intent and
  transaction: one credit.
- `pauseMission` racing `advance` (the usage tick): the final state is paused
  and no usage reading is lost.
- `processDemoTraffic` called concurrently N times: the metered total is the
  sum of all N.
- The claim reconciliation case from requirement 4.

Each new test must fail on the code before the change, unless the requirement
says "pin it".

## Done when

`npm run check` and `npm test` pass, apart from the one test known to fail
before this work
(`src/rails/MonadRail.anvil.test.ts`, "claim() pulls tranche on-chain…").
