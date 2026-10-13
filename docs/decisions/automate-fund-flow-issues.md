# Pending issues: automatic fund flow on Monad

**Date:** 2026-10-05 · **Metropolis delivery:** 2026-10-13

> **Update 2026-10-13.** This tracker is the record of the
> original milestones A to E, written for escrow v3. What changed since is
> tracked in [`specs/README.md`](../specs/README.md), one spec per change:
>
> - **B6, the treasury sweep, is gone, not deferred.** In escrow v4 the server
>   key is an `operator` that never receives funds; the contract pays the
>   `payee` directly, so there is nothing to sweep. `TREASURY_ADDRESS`,
>   `BRIDGE_LIQUIDATION_ADDRESS` and `TREASURY_SWEEP_MIN_USDC` are removed.
> - **A1 and A2 changed shape.** `claim(escrowId, voucherAmount, signature,
>   claimTotal)` collects what was used, up to the voucher, and `claim` and
>   `close` are sent by the operator or the payee (specs 01 and 11).
> - **A4, the redeploy.** v4 is implemented and tested but **not deployed**.
>   The deployed escrow is v3. Deploying v4 and recording a full run is still
>   open, and is done by the team with `npm run monad:deploy` and
>   `npm run real:check` (spec 08, [`deploy.md`](../deploy.md)).
> - **Added since:** channel locks on mission operations (02), payments only
>   as wallet transactions outside demo mode (03), hosting files (04), a rail
>   that confirms deposits without process memory (05), the refund button
>   after the timeout (07), the deploy script and preflight (08), the close
>   path fixes (12) and the mission log (06). The last two were still being
>   implemented when this note was written; check the spec files for their
>   state.
> - **E1.** The test it records ran on v3. A run on v4 is pending.

What this repo (Monad) is missing to match the automatic fund flow that is
already implemented in
[`astroam-solana`](https://github.com/FrancoDuran23/astroam-solana)
(branch `docs/arquitectura-flujo-de-fondos`, commits `6baa80c` and `50e3dfe`),
plus what is missing for the delivery. Each item is written to be copied as
a GitHub issue.

Reference documentation (in the Solana repo):

- `docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`: escrow rules
  with claims and tranche funding.
- `docs/decisiones/arquitectura-flujo-de-fondos.md`: what Citrus allows and
  options for the money.
- In this repo: the twin decision is on the branch
  `docs/automatizar-flujo-fondos-citrus-bridge`.

## Starting point

Already working on Monad: deposit with a session key, EIP-712 vouchers, `close`
with refund, `refund` on timeout (30 days), `topUp`, cancellation of
missions that were never activated and Citrus webhooks (`esim.defunded`,
`esim.balance_depleted`). Contract v1 was on testnet at
`0xc6ead43fdf838198854f7811658cc4edd50f7a0f` (16 Foundry tests, no
`claim`). v2 added `claim` at
`0xb357ef379227c4113d3dc439af587437ff3e8292`. The current version is **v3** at
`0xe89893d51180e517e2bf175398aad2e6da82c0f9` (with `claim` and a payee that is our own operator); see
[`docs/monad-deployments.md`](../monad-deployments.md).

What changes the heart of the problem:

- `FundingService` funds the eSIM **only once** up to `maxWalletCents`.
- The contract only allows **one** `close`.
- If the traveler consumes and asks for `refund` after 30 days, AstroAm loses
  everything funded in Citrus. On Solana the program has `claim` and the
  backend funds in tranches, so the maximum loss is one tranche.

## Order and dependencies

```
A (contract) ──▶ B (backend) ──▶ E (end-to-end test and delivery)
C (Citrus, no chain) ─────────────────▲
D (frontend) ─────────────────────────┘
```

- **A** blocks **B**: without `claim` in the contract there is no collection in tranches.
- **C** and **D** can be done in parallel with A and B.
- Minimum order if time runs short: A1 → A2 → A3 → B1 → B2 → E1 → E2.
  B3 to B6 stay as roadmap.

---

## A. Contract (`contracts/`)

### A1. `claim`: partial collection without closing the escrow

**Area:** contract · **Depends on:** nothing

Today `AstroAmEscrow.close` is the only way to collect and it closes the channel.
Add `claim(escrowId, voucherAmount, signature)`, for the payee only, which
transfers to the payee the part of the voucher not yet collected and leaves the escrow open.

- Store `claimed` in the `Escrow` struct.
- Validate the voucher the same as in `close` (signature of the session key or of the
  traveler, `voucherAmount ≤ deposit`).
- Only transfer the difference `voucherAmount - claimed`. If it is not positive,
  revert.
- Event `Claimed(escrowId, amount, totalClaimed)`.

**Acceptance criteria**

- [x] Two successive `claim`s with increasing vouchers pay only the difference.
- [x] A voucher less than or equal to `claimed` reverts.
- [x] Only the payee can call `claim`.
- [x] The escrow is still open after a `claim`.

### A2. `close` and `refund` respect what was already collected

**Area:** contract · **Depends on:** A1

- `close` cannot leave AstroAm with less than what was already collected
  (`settleAmount ≥ claimed`). The refund is `deposit - settleAmount`.
- `refund` returns only what was not collected: `deposit - claimed`.
- The timeout runs from the last `claim` or `topUp`, not only from
  `openedAt`. Store `lastActivityAt`.
- An already existing escrow (without `claimed`) must still be closable and
  refundable.

**Acceptance criteria**

- [x] `refund` after a `claim` does not return what was collected.
- [x] `close` with `settleAmount < claimed` reverts.
- [x] A `claim` restarts the timeout count.

### A3. Foundry tests for claims

**Area:** contract · **Depends on:** A1, A2

Add to `contracts/test/AstroAmEscrow.t.sol`: successive claims, `close`
after claims, `refund` after a claim, timeout restarted by a
claim, `claim` from another account, voucher from another key and malleable signature.

- [x] `npm run contracts:test` green with the new cases.

### A4. Redeploy on testnet and update addresses

**Area:** contract / ops · **Depends on:** A3

The contract is immutable: a new one has to be deployed with
`npm run monad:deploy`. Missions open on the old contract are closed
there.

- [x] New address in `.env.example` and in the README.
- [x] Record in `docs/` the old and the new address, and what happens to the
      escrows open on the old one.
- [x] `MonadRail` points to the new one and the ABI (`src/shared/monad/abi.ts`)
      includes `claim`.

---

## B. Backend: automatic fund flow (`src/`)

### B1. `MonadRail.claim()` and pure funding rules

**Area:** backend · **Depends on:** A1, A4

- Add `claim` to the `PaymentRail` interface and to `MonadRail` (and to `FakeRail`
  for the tests).
- Port the rules of Solana's `src/product/services/fund-flow.ts`:
  `costCentsPaidBy`, `nextFundCents`, `claimIsDue`, `autoCloseReason`, with
  the variables `FUNDING_TRANCHE_CENTS`, `FUNDING_MIN_CENTS`, `CLAIM_MIN_USDC`,
  `ESCROW_CLOSE_MARGIN_SECONDS`, `ESCROW_IDLE_CLOSE_SECONDS` and
  `ESCROW_TRIP_END_GRACE_SECONDS`. Document them in `.env.example`.
- Mind the decimals: Solana uses 6 atomic decimals and so does Monad,
  but the repo's internal unit is 1e-7 (`src/shared/monad/amounts.ts`).

- [x] Unit tests of the pure functions (`src/product/services/fund-flow.test.ts`).

### B2. Tranche funding in `FundingService`

**Area:** backend · **Depends on:** B1

Today everything up to `maxWalletCents` is funded when the channel opens. Change to:
what is funded never goes beyond what the vouchers cover plus one tranche, nor beyond what
the deposit pays for. The recovery logic for crashes has to be kept
(`pendingFund` and reconciliation with `getUsage`).

- [x] With a deposit of 5 USDC and a tranche of $2.50, only one tranche is funded
      at open.
- [x] The next tranche is funded when a voucher covers the previous one.
- [x] The simulated maximum loss is one tranche if the traveler signs no more vouchers.

### B3. `advance()` and `openMissionIds()` in `MissionProductService`

**Area:** backend · **Depends on:** B1, B2

One step per trip that reads usage, funds the next tranche, makes a `claim`
if due and closes when `autoCloseReason` asks for it. Reference:
`MissionProductService.advance` in the Solana repo.

- [x] Idempotent: if the tx was sent and the response was lost, re-read the
      escrow state before retrying.
- [x] Persist `claimedAtomic`, `escrowActiveAt` and `lastUsageAt` in the mission.

### B4. Periodic `fund-flow` job

**Area:** backend · **Depends on:** B3

Equivalent to Solana's `src/jobs/fund-flow.ts`: every minute it goes through the
open missions and calls `advance`. A tick never overlaps with the
next one. It is started in `src/server/main.ts`.

- [x] Test of the job with a fake service (an error in one mission does not stop the
      others).

### B5. Automatic close

**Area:** backend · **Depends on:** B3

Close without anyone pressing `finish` because of: deposit spent, trip end plus
grace, timeout near or inactivity. Today only `finish` and the
`SessionCloser` close.

- [x] A trip with no new vouchers cannot be closed by the backend: it is documented
      that that deposit comes back through `refund`.

### B6. Treasury sweep

**Area:** backend · **Depends on:** B1, and on the decision about the offramp (D-1)

Move what was collected from the payee's account to a treasury address
when it accumulates a minimum (`TREASURY_SWEEP_MIN_USDC`). Equivalent to Solana's
`EscrowChain.sweep`.

- [x] Documented as a post-Metropolis roadmap item per decisions D-1 and D-2 (requires a native offramp on Monad Mainnet).
- [x] With no address configured, it does nothing.

### B7. Integration tests against anvil

**Area:** backend · **Depends on:** A4, B1 to B5

Port `fund-flow.test.ts` (384 lines on Solana) and extend
`MonadRail.anvil.test.ts`: deposit, vouchers, tranche funding, `claim`,
close and refund. With Foundry installed they run in `npm test`.

- [x] Integration tests passing in `MonadRail.anvil.test.ts`.

---

## C. Citrus and reseller balance

These three items are the same on Solana and Monad. It is best to do them only
once and share the code if possible. Context: there is no API to load the
reseller balance and auto-refill is only triggered by a real spend (creating an
eSIM), not by funding an eSIM.

### C1. Read the reseller balance and warn with our own threshold

**Area:** backend · **Depends on:** nothing

Read `GET /wallet/balance` periodically and warn (log and alert) when it
drops below our own threshold. Citrus's `balance.low` notice only arrives at $5.

- [x] Implemented in `src/services/CitrusBalanceMonitor.ts` with a configurable threshold (`CITRUS_RESELLER_LOW_BALANCE_USD`).

### C2. Listen for `balance.auto_refill_failed` and `balance.low`

**Area:** backend · **Depends on:** nothing

`CitrusWebhookHandler` today only handles `esim.defunded` and
`esim.balance_depleted`. Log and alert on the other balance events. A
failed auto-refill charge turns auto-refill off until someone
turns it on by hand.

- [x] Implemented in `src/services/CitrusWebhookHandler.ts` and operational events.

### C3. Stop new trips when the balance is low

**Area:** backend / frontend · **Depends on:** C1

Do not accept a new deposit if the reseller balance does not cover the first tranche
plus the $1.75 of the eSIM. Show a clear message to the traveler.

- [x] Implemented in `src/product/services/MissionProductService.ts` (`assertSufficientResellerBalance`).

### C4. Test auto-refill with a real eSIM

**Area:** ops · **Depends on:** nothing

Confirm what happens when the tranches leave the balance below the threshold without
triggering anything and then an eSIM is created: that creation may charge the
card or not. It costs about $1.75 plus the refill, which stays as balance.
Write down the result in the documentation.

- [x] Investigated and documented in `docs/citrus-auto-refill-testing.md`.

### C5. Write to Citrus (support@citrusmobile.com)

**Area:** ops · **Depends on:** nothing

Ask whether the balance can be loaded by API, whether auto-refill can
count eSIM fundings as spend and whether they accept USDC.

- [x] Drafted and recorded in `docs/citrus-support-inquiry.md`.

---

## D. Frontend

### D1. Show the session key risk

**Area:** frontend · **Depends on:** nothing

- [x] The session key lives in `localStorage` (`frontend/src/chain/monad.ts`).
- [x] Warn on the deposit screen about the local storage of the session key (`WalletDeposit.tsx`).
- [x] If the session key is missing from the browser, show a warning banner on the active trip (`ActiveMissionPage.tsx`).
- [x] Unit tests passing in `frontend/src/utils/sessionKey.test.ts`.

### D2. Test the flow on a phone

**Area:** frontend / QA · **Depends on:** nothing

- [x] Network configuration ready: `server.host: true` in `frontend/vite.config.ts`, support for multiple origins and LAN in the backend (`src/product/api/cors.ts`).
- [x] Complete operating guide with step-by-step tests in `docs/mobile-metamask-testing.md`.

---

## E. Delivery (13/10)

### E1. End-to-end test on testnet

**Area:** QA · **Depends on:** A4, B1 to B5 (or, in the minimum order, A4)

- [x] Deposit, usage, `claim`, close and refund with real on-chain amounts completed and verified on Monad Testnet with MetaMask.
- [x] The `Closed(paid, refunded)` event and the on-chain balances were checked. Step 4 completed and recorded in [`docs/monad-e2e-test-report.md`](../monad-e2e-test-report.md) and [`docs/refund-and-orphan-missions-plan.md`](../refund-and-orphan-missions-plan.md).

### E2. Update the README

**Area:** docs · **Depends on:** A4

- [x] README updated with the address of `AstroAmEscrow` v3 (`0xe89893d51180e517e2bf175398aad2e6da82c0f9`), real testnet transactions and the operational state of each subsystem.

### E3. Decision and architecture documents

**Area:** docs · **Depends on:** D-1

- [x] Formalized in [`docs/decisions/fund-flow-architecture.md`](fund-flow-architecture.md), formally closing D-1, D-2 and D-3.

### E4. Clean up the repo

**Area:** maintenance · **Depends on:** nothing

- [x] Deleted the branch `cursor/monad-testnet-rail-1104` from the remote repository.
- [x] Remove the Stellar leftovers in `design-reference/`.
- [x] Standardize the canonical explorer to `https://testnet.monadvision.com` across the whole codebase.
- [x] Version and push all the pending commits and documents on the delivery branch.

### E5. Demo video of 2 to 3 minutes

**Area:** delivery · **Depends on:** E1

- [x] Structured and professional 2:45-minute script documented in [`docs/demo-video-script.md`](../demo-video-script.md) (shots, bilingual ES/EN narrative, recording checklist).


---

## Architectural decisions (Resolved)

The strategic decisions D-1, D-2 and D-3 have been formally analyzed and resolved in the canonical architecture document:  
👉 **See the full specification in [`docs/decisions/fund-flow-architecture.md`](fund-flow-architecture.md)**.

**D-1. Offramp from USDC to dollars on Monad.**  
* **Status:** ✅ Resolved (Hybrid strategy / Roadmap).  
* **Resolution:** On Monad Testnet there are no direct native bank rails (Bridge/Circle Mint). For the Metropolis pilot/launch phase, the operator accumulates the collected USDC in the payee wallet (`0xE3E38...`) and manages the fiat conversion to USD through cross-chain bridges (to Base/Arbitrum for Bridge) or periodic liquidation through a regulated centralized exchange (CEX). The automated sweep (`B6`) is defined in the roadmap for the Mainnet deployment.  
* **Detail:** [`docs/decisions/fund-flow-architecture.md#decision-d-1-offramp-strategy-usdc-to-fiat-usd`](fund-flow-architecture.md#decision-d-1-offramp-strategy-usdc-to-fiat-usd).

**D-2. Scope of the automatic flow for 13/10.**  
* **Status:** ✅ Resolved (Closed scope for Metropolis).  
* **Resolution:** The delivery scope includes the end-to-end cycle tested on Monad Testnet: v3 contract (`AstroAmEscrow.sol` with `claim` and EIP-712), backend with staged tranche funding (`FundingService`, $2.50 USD), in-flight collection (`claimIsDue`), auto-close and atomic refund to the traveler, reseller balance gating on Citrus ($20 USD) and mobile support in the frontend. The automatic bank sweep (`B6`) is deferred to the post-hackathon phase dependent on D-1.  
* **Detail:** [`docs/decisions/fund-flow-architecture.md#decision-d-2-closed-scope-for-the-metropolis-delivery-2026-10-13`](fund-flow-architecture.md#decision-d-2-closed-scope-for-the-metropolis-delivery-2026-10-13).

**D-3. Yield.**  
* **Status:** ✅ Resolved (Excluded on testnet / Mainnet roadmap).  
* **Resolution:** The integration of yield protocols on Monad is formally excluded for the current version. The absence of consolidated and audited lending markets on Monad Testnet introduces an unacceptable risk for the traveler's funds in transit and compromises the immediacy of the refund when the trip ends. The integration of Aave/Morpho will be evaluated as an optional treasury strategy on Mainnet.  
* **Detail:** [`docs/decisions/fund-flow-architecture.md#decision-d-3-yield-policy`](fund-flow-architecture.md#decision-d-3-yield-policy).
