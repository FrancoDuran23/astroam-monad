# Spec v2: replace Telnyx with Citrus Mobile (AstroAm)

> **Note:** this document was written when AstroAm's base charged on
> Stellar. Today the payments part goes through each chain's payment rail
> (`src/rails/PaymentRail.ts`); everything about Citrus is still current.

This document is the **single source** for the migration. It replaces spec v1 (`docs/citrus-mobile-spec.md`) and the plan derived from it. If something clashes with the README, the README's section "Decision: meter with the provider, no gateway of our own" prevails, except where this document refines it (marked **[refinement]**).

Technical reference for the Citrus API: `citrus-mobile-brief.md`. This spec defines **what to build and when it is done**; the brief explains how Citrus works.

---

## 1. Goal

That all of AstroAm's connectivity (eSIM provisioning, funding its wallet, reading usage, cutoff, refund) works on **Citrus Mobile**, feeding the voucher flow of the payment channel that already exists, and to retire Telnyx.

## 2. Current decisions

| # | Decision | Origin |
|---|---|---|
| D1 | There is no gateway of our own. Citrus does the usage metering and the cutoff. | README |
| D2 | Usage is read from Citrus (`total_data_charged_usd`) every ~10 min and feeds the meter. | README |
| D3 | The `ConnectivityProvider` interface is replaced by the Citrus shape. Telnyx and Citrus do not coexist. | Decided |
| D4 | `setDataLimit` is removed. The cap is given by the eSIM's prepaid wallet. | Decided |
| D5 | Conditional wiring by `CONNECTIVITY_PROVIDER` in `server/main.ts`. Without the variable, the current behavior does not change. | Decided |
| D6 | File-based persistence (JSON/JSONL) with the repo's pattern. No SQL. | Decided |
| D7 | The voucher agent, its guardrails and the payment channel logic are **not touched**. | Constraint |
| D8 | The eSIM is one per user and is reused between trips. It is not terminated when a trip closes. | README |

## 3. Scope

**Inside:** `CitrusProvider`/`CitrusClient`, factory and selector, adaptation of the meter and the `PolicyEnforcer`, close sequence, eSIM persistence, minimal webhooks, config through zod, tests, demos and the retirement of Telnyx.

**Outside (do not touch):** `src/agent/*` (including `guardrails.ts`), the collection and channel server (`src/server/channel-*`, `close-monitor`), the chain code, the deposit payment, `settle`. Citrus's shared balance groups (`/groups`) are not used either: a SIM in a group has no individual wallet or usage.

## 4. Current state (complete implementation of the migration)

State at the migration commit: **T1–T8 and T10 are implemented and green** (`npm run check`, `npm test`). **T9 (smoke test with real money, §10) remains pending**: it requires loading the Citrus dashboard and validating costs (C7, §12). What follows is the state of the repo at this commit:

- `ConnectivityProvider` with the new Citrus shape (R2): `provisionEsim | topUp | getUsage → SimUsage{chargedMicroUsd, walletMicroUsd, status, asOf} | suspend | resume | refundUnused | terminate`. `simCardId === iccid`; there is no `purchaseEsim`, `enable`, `disable` or `setDataLimit`. `FakeProvider` implements the same interface for tests and demos.
- `createConnectivityProvider()` (R1) resolves by `CONNECTIVITY_PROVIDER=fake|citrus` (default `fake`). `CitrusProvider` + `CitrusClient` (axios, configurable base URL, token bucket ≤ 100 req/min, retries with `withRetry`) and the `CitrusApiError` / `CitrusRateLimitedError` / `CitrusResellerBalanceError` taxonomy (`src/shared/citrus-errors.ts`).
- `PolicyEnforcer` (R8): actions `suspend | noop` with `PRICE_PER_MB_RAW` as a dependency (removed `set_data_limit`, the low threshold and the direct read of `process.env`). `decidePolicy({balanceRaw, costRaw, pricePerMbRaw})` suspends if the balance reaches 0 or does not cover 1 MB equivalent.
- `IntegratedMeterService.processCumulative(cumulativeBytes)` (R7) reuses `requestVoucher → creditIfSigned → decidePolicy`; `processTraffic` is kept for the demos. `arePricesAligned` and `pricePerMibFromPerMbRaw` are kept (`src/shared/money.ts`).
- `FundingService` (R5): funding of the gap up to the `maxWalletCents` ceiling (I2, `src/shared/usage-math.ts`); persists `pendingFund` before `POST /fund` and reconciles against the wallet after a timeout/crash; a definitive rejection (400/401/404/409) clears the durable attempt and rethrows.
- `SessionCloser` (R9): `refundUnused → wait for esim.defunded (webhook or timeout) → final usage → last voucher → channel closed → idle`; `terminate` only with wallet 0 and no pending `defund` (local rejection `CitrusTerminateWithBalanceError`).
- `CitrusWebhookHandler` + `POST /citrus/webhooks` with `express.raw({ type: "application/json" })` (R10): HMAC-SHA256 verification of the **raw body** with `CITRUS_WEBHOOK_SECRET` against `X-Citrus-Signature` (hex or `sha256=`), in constant time; 401 if invalid. JSONL persistence before responding 200, dedup by `id`, reprocessing of unprocessed events at startup. It handles `esim.defunded` and `esim.balance_depleted`; the rest are logged and answered with 200.
- File-based persistence (R11): `src/persistence/esim-record.ts` (map `iccid → {userRef, channelId, status, fundedMicroUsd, pendingFund, chargedBaselineMicroUsd, defundPending, createdAt}`) and `src/persistence/webhook-event.ts` (append-only JSONL, durable dedup).
- zod config (R12): `CONNECTIVITY_PROVIDER`, `CITRUS_API_KEY`, `CITRUS_BASE_URL`, `CITRUS_WEBHOOK_SECRET`, `CITRUS_REQUEST_TIMEOUT_MS`, `PRICE_PER_MB_RAW` (rename of `TELNYX_PRICE_PER_MB_USDC`), `MARKUP_BPS=15000`, `USDC_USD_RATE_BPS=10000`, `USAGE_POLL_INTERVAL_MS=600000`, `CITRUS_UNPAID_CAP_BPS=1000`, `CITRUS_DEFUND_STABLE_WINDOW_MS=300000`, `CITRUS_DEFUND_TIMEOUT_MS=3600000`. With `citrus`, `PRICE_PER_MB_RAW` is required and the superRefine validates `arePricesAligned` with `PRICE_PER_MIB_RAW`. `.env.example` already has the Citrus section.
- `ConnectivitySession` (R13): `provider: "citrus"`, `chargedMicroUsd`, `chargedBaselineMicroUsd`, `fundedMicroUsd`; removed `carrierBytes` and `simCardId`.
- Reconciliation (R13): `src/jobs/reconciliation.ts` contrasts `charged − baseline` against `funded − walletUsd` (drift = wallet − expected); diagnostic only, never throws or affects billing. `mbToBytes` removed.
- `server/main.ts` (D5): webhooks mounted only if `CONNECTIVITY_PROVIDER=citrus` + `CITRUS_WEBHOOK_SECRET` + `PRICE_PER_MB_RAW`, inside a try/catch that degrades with a log without preventing `listen` (FC-R1). The usage-loop and `FundingService` are not mounted in the HTTP lifecycle: metering and funding remain governed by the existing routes (close) and by manual operation — the value integration (R5/R6/R9) is left for T9.
- Demos (R14): the demos run without a network using `FakeProvider` and the new interface.
- R15: removed `src/providers/connectivity/TelnyxProvider.ts`, `TelnyxProvider.test.ts` and `docs/telnyx-wireless-integracion.md`; removed the `TELNYX_*` vars; README updated ("Missing" checklist, Provider section, documentation).
- Stack: Node ≥22.18 running `.ts` directly, strict ESM TypeScript, tests with `node:test`. Commands: `npm run check`, `npm test` (451 tests green).

## 5. Citrus constraints

- **C1.** Prepaid in USD. Each eSIM has its own wallet; on reaching $0 the network cuts the data.
- **C2.** No bytes endpoint. Usage arrives in USD: `total_data_charged_usd` is **accumulated over the SIM's lifetime** (not per trip).
- **C3.** Delay of ~10 to 15 min in usage and balance. After each `fund`, reporting pauses for ~15 min.
- **C4.** `defund` is asynchronous: it responds 202, pauses the data immediately and credits the reseller account in ~15 min (`esim.defunded`). While it lasts, that SIM cannot be `fund`ed or `enable`d. It does not terminate the SIM.
- **C5.** `wallet_balance_usd` is rounded down by up to ~5¢. The amount returned by `defund` is the displayed balance.
- **C6.** Rate limit 100 req/min per key. No documented idempotency keys.
- **C7.** No sandbox (README): tests use real money.
- **C8.** `terminate` is irreversible and loses the remaining balance.

## 6. Billing model

Citrus charges the reseller at retail rate −10%. The traveler is charged retail × 1.35. Therefore **the traveler pays 1.5 times what Citrus deducts from the wallet** (`MARKUP = 1.5`; margin ≈ 33%).

### 6.1 Definitions (everything in `bigint` integers, no `float`)

- `chargedMicroUsd`: `total_data_charged_usd` converted to micro-USD at the provider's edge.
- `chargedBaselineMicroUsd`: reading of `total_data_charged_usd` when the channel is opened. Trip usage: `chargedSession = charged − baseline` (never decreasing).
- `MARKUP_BPS = 15000`, `USDC_USD_RATE_BPS = 10000` (1 USDC = 1 USD, see §12).
- `PRICE_PER_MB_RAW` (renamed from `TELNYX_PRICE_PER_MB_USDC`) and `PRICE_PER_MIB_RAW`, aligned as today.

### 6.2 Equivalent bytes **[refinement]**

The README says "bytes = USD charged ÷ the country's rate". It is implemented by deriving the conversion from the price itself and the markup, without a per-country table:

```
equivalentBytes = floor( chargedSessionMicroUsd × MARKUP_BPS × 10_000_000
                         / (USDC_USD_RATE_BPS × PRICE_PER_MB_RAW) )
```

With that formula, `equivalentBytes × PRICE_PER_MB_RAW` gives exactly `chargedSession × MARKUP` in USDC, so **billing follows what Citrus deducts, regardless of country or operator**. The "bytes" are a unit of account for the voucher agent; they only resemble real bytes in the country whose rate is `PRICE_PER_MB_RAW`. The UI must show USDC spent, not MB.

Example (Brazil, `PRICE_PER_MB_RAW = 25000`): usage of $3.60 → 2,160,000,000 equivalent bytes → 2160 MB × 25000 = 54,000,000 raw = **5.4 USDC = 3.60 × 1.5**.

### 6.3 Invariants

- **I1 (billing).** The accumulated voucher amount for `equivalentBytes` is ≈ `chargedSession × MARKUP` (± the `ceil` rounding per MiB, ≤ 0.01%).
- **I2 (wallet cap).** The sum funded to the eSIM in the trip does not exceed:
  ```
  maxWalletCents = floor( depositRaw × USDC_USD_RATE_BPS / (100_000 × MARKUP_BPS) )
  ```
  Example: deposit of 5 USDC (50,000,000 raw) → 333 cents ($3.33). With I1 and I2, the traveler can never consume more than was deposited and the channel is not overdrawn.

## 7. Requirements

Each with an acceptance criterion (AC).

**R1. Selector and factory.** `createConnectivityProvider()` resolves by `CONNECTIVITY_PROVIDER` (`fake | citrus`, **default `fake`**). Fails fast with an actionable message if the Citrus config is missing.
- AC: without the variable, server, tests and demos behave as today; with `citrus` and without `CITRUS_API_KEY`, startup fails naming the variable.

**R2. New interface.** Replaces the current one; `setDataLimit` disappears.
```ts
type EsimRecord = { iccid: string; lpaString: string; qrCode: string; directInstallUrl: string; status: string };
type SimUsage   = { chargedMicroUsd: bigint; walletMicroUsd: bigint; status: string; asOf: string };
interface ConnectivityProvider {
  provisionEsim(userRef: string, label?: string): Promise<EsimRecord>;
  topUp(iccid: string, amountCents: number): Promise<void>;
  getUsage(iccid: string): Promise<SimUsage>;
  suspend(iccid: string): Promise<void>;
  resume(iccid: string): Promise<void>;
  refundUnused(iccid: string): Promise<void>;   // defund
  terminate(iccid: string): Promise<void>;
}
```
`simCardId === iccid`. A `FakeProvider` implements the same interface for tests and demos.
- AC: `npm run check` green; no file references `setDataLimit`, `purchaseEsim` or the provider's `mb`.

**R3. `CitrusClient`.** Thin HTTP client (reuse the `HttpClient` pattern from `TelnyxProvider`): configurable base URL, `Authorization: Bearer rsk_…`, rate limiter (budget ≤ 80 req/min), retries with `withRetry`.

| Code | Behavior |
|---|---|
| 429 | Retry respecting `Retry-After` |
| 502, 503 (`NO_ESIMS_AVAILABLE`) | Retry with backoff and a cap |
| 400, 401, 404, 409 | Do not retry; domain error |
| 402 `INSUFFICIENT_BALANCE` | `CitrusResellerBalanceError` (operational alert, not a user error) |
| Timeout on `fund` | Do not retry blindly (see R5) |

- AC: table-driven test over the codes with mocked responses; the key never appears in logs.

**R4. Idempotent provisioning.** `provisionEsim(userRef)` calls `POST /esim/provision` with `end_user_reference=userRef`. If the user already has an eSIM with a state ≠ `terminated`, it is reused. A lock per `userRef` (`createChannelMutex` with key `esim:${userRef}`) prevents concurrent duplicate provisioning.
- AC: two simultaneous calls with the same `userRef` produce a single eSIM and a single provisioning charge.

**R5. Wallet funding.** It is funded **once when the channel is opened** and **again if the channel receives a top-up**, with no tranche funding. The amount is the gap up to `maxWalletCents` (I2) minus what was already funded in the trip, in whole cents. Before `POST /fund`, `pendingFund` is persisted; after the response it is confirmed. After a timeout or crash, it is reconciled with `GET /esim/{iccid}` by comparing `wallet_balance_usd` against the previous value, instead of retrying.
- AC: funded wallet × MARKUP ≤ deposit in all the test cases; a simulated timeout does not duplicate the funding; a crash between `pendingFund` and the response is resolved on restart.

**R6. Usage reading.** A loop reads `getUsage(iccid)` every `USAGE_POLL_INTERVAL_MS` (default 600,000; minimum 60,000; the data does not improve below ~5 min). It maintains `chargedBaselineMicroUsd` (saved when the channel is opened, see R9 on when to read it) and computes `equivalentBytes` with §6.2, with monotonicity (`max` with the previous reading).
- AC: with mocked readings, `equivalentBytes` matches the formula of the §6.2 example; a reading lower than the previous one does not reduce the accumulated amount.

**R7. Vouchers.** The meter receives accumulated `equivalentBytes` and requests the voucher through the current flow (`requestVoucher` → `POST /vouchers`). An idempotent method is added to `IntegratedMeterService` (for example `processCumulative(cumulativeBytes)`) that reuses `requestVoucher`, `creditIfSigned` and `decidePolicy`; `processTraffic` is kept for the demos. **The agent and `PRICE_PER_MIB_RAW` are not modified.** `arePricesAligned` is kept.
- AC: a voucher for `equivalentBytes` is accepted by the real agent in a local integration test; the quota is only credited with a signed voucher.

**R8. Cutoff.** `PolicyEnforcer` removes the `set_data_limit` action and the low threshold. If the channel's remaining balance reaches 0 (or does not cover 1 MB equivalent), or the agent rejects a voucher in a non-retryable way (`channel_exhausted`, `channel_closing`), `suspend()` is called. **Never noop.** It serves as a backup: the natural cutoff is given by the wallet (I2).
- AC: regression test: channel without balance → `suspend` invoked; the cost basis uses the same `equivalentBytes` as the voucher.

**R9. Trip close.** Sequence in a new component (for example `SessionCloser`) that uses the server's existing close port, without modifying it:
1. `refundUnused(iccid)` (`defund`): pauses data, `defund_pending` blocks `topUp`/`resume`.
2. Wait for `esim.defunded` (or backup polling with a timeout; see §12).
3. Final usage = `charged` read **after** the settlement − `baseline`. Cross-check: `funded − returned_usd` (tolerance ≤ 5¢ for rounding, C5). If they differ by more, alert and use the lower one.
4. Request the last voucher for the final usage; the server collects and the rest returns to the traveler (existing flow).
5. The eSIM stays `idle` and installed (D8). `terminate` is only allowed with wallet 0 and no pending `defund`, and is not part of the normal flow.
- AC: in a test with `FakeProvider` with a simulated delay, the last voucher reflects the usage after the settlement; `terminate` with balance > 0 is rejected locally.

The next trip's `baseline` is read right before the first `fund`, with the SIM without traffic and without a pending `defund`. Since `defund` pauses data and has already settled, the reading is not stale.

**R10. Webhooks (minimum).** Route `POST /citrus/webhooks` with `express.raw({ type: "application/json" })` mounted only if `CONNECTIVITY_PROVIDER=citrus`, without affecting other routes (the only modification in `app.ts` or `main.ts`). It verifies the HMAC-SHA256 signature of the **raw body** with `CITRUS_WEBHOOK_SECRET` against `X-Citrus-Signature`, in constant time, accepting hex with or without the `sha256=` prefix (Citrus does not document the format). Invalid signature → 401. **Persist the event to the JSONL before responding 200**, then process; at startup, reprocess those not marked `processed_at` and rebuild the dedup set by `id`. Events handled: `esim.defunded` and `esim.balance_depleted`; the rest are recorded and answered with 200. The remaining events (`esim.activated`, `balance.*`, etc.) are deferred.
- AC: an event with a valid signature is processed once even if it arrives twice; with an invalid signature it is rejected; `POST /webhooks/{id}/test` returns 200 against the running server.

**R11. File-based persistence.** `src/persistence/esim-record.ts` (map `iccid → { userRef, channelId, status, fundedMicroUsd, pendingFund, chargedBaselineMicroUsd, defundPending, createdAt }`) and `src/persistence/webhook-event.ts` (append-only JSONL). Atomic writes with the pattern of `channel-record.ts`; map writes serialized with `createChannelMutex`.
- AC: two concurrent writes to the same record do not lose data; a restart keeps the dedup.

**R12. Configuration through zod.** In `src/config/env.ts` (`sharedSchema`), reusing `rawPositiveIntegerRaw()`:

| Variable | Notes |
|---|---|
| `CONNECTIVITY_PROVIDER` | `fake \| citrus`, default `fake` |
| `CITRUS_API_KEY` | prefix `rsk_`; required only with `citrus` |
| `CITRUS_BASE_URL` | default `https://citrusmobile.com/api/v2/reseller` |
| `CITRUS_WEBHOOK_SECRET` | prefix `whsec_`; required only if webhooks are mounted |
| `PRICE_PER_MB_RAW` | rename of `TELNYX_PRICE_PER_MB_USDC`; same semantics and alignment with `PRICE_PER_MIB_RAW` |
| `MARKUP_BPS` | default 15000 |
| `USDC_USD_RATE_BPS` | default 10000 |
| `USAGE_POLL_INTERVAL_MS` | default 600000; min 60000 |

`.env.example` replaces the Telnyx section with Citrus, without real values. Update messages and comments that name Telnyx.
- AC: `grep -ri "TELNYX_PRICE_PER_MB_USDC"` empty; invalid values fail at startup naming the variable.

**R13. Reused reconciliation.** `src/jobs/reconciliation.ts` stops comparing against the gateway and starts contrasting two Citrus figures: `charged − baseline` against `funded − walletUsd`. Diagnostic only: it records the difference (tolerance ≥ 5¢ + lag), never throws or affects billing. `ConnectivitySession` becomes `provider: "citrus"`, removes `carrierBytes` and adds `chargedMicroUsd`, `chargedBaselineMicroUsd`, `fundedMicroUsd`.
- AC: with mocked readings the job logs the difference and does not throw on provider errors.

**R14. Tests and demos.** Contract tests with OpenAPI fixtures; error table; timeout on `fund`; invariants I1 and I2; `PolicyEnforcer` with `suspend`; close sequence; duplicate webhook and invalid signature; concurrency of `provisionEsim` and of writes. The app still runs without a network using `FakeProvider` and `FakeRail`.
- AC: `npm run check` and `npm test` green.

**R15. Retirement of Telnyx.** Last commit, **only after the smoke test (T9)**: delete `TelnyxProvider.ts` and its test, `docs/telnyx-wireless-integracion.md`, the `TELNYX_*` variables; update the README ("Missing" checklist and Provider section).
- AC: `grep -ri telnyx` empty in code and config (it stays in git history).

## 8. Design

**New components:** `providers/connectivity/{CitrusClient,CitrusProvider,FakeProvider,createConnectivityProvider}.ts`, `shared/{token-bucket,citrus-errors}.ts`, `services/{SessionCloser,CitrusWebhookHandler,FundingService}.ts`, `server/routes/citrus-webhooks.ts`, `persistence/{esim-record,webhook-event}.ts`.

**Modified (minimal adjustment):** `ConnectivityProvider.ts`, `ConnectivitySession.ts`, `PolicyEnforcer.ts`, `meter-service.ts`, `reconciliation.ts`, `config/env.ts`, `.env.example`, `server/main.ts` (a single registration call), `scripts/demo-*.ts`.

**Flow of a trip**

1. **Opening.** USDC deposit → payment channel opened → `provisionEsim` (or reuse) → read `baseline` → `topUp` to `maxWalletCents` (I2) → deliver QR / `directInstallUrl` to the traveler.
2. **Metering (every ~10 min).** `getUsage` → `chargedSession` → `equivalentBytes` → signed voucher → quota credited → `PolicyEnforcer` evaluates.
3. **Channel top-up.** New gap up to the new `maxWalletCents` → `topUp` for the difference.
4. **Close.** R9.

**Internal eSIM states:** `provisioned → active → (cut) → defund_pending → idle → active …`; `terminated` only by explicit operation.

## 9. Task plan

| # | Task | Depends on | Done when | Status |
|---|---|---|---|---|
| T1 | New interface + `FakeProvider`; adapt consumers and demos (R2, R14 partial) | — | `npm run check` and demos green | ✓ done |
| T2 | zod config and selector (R1, R12) | T1 | AC of R1 and R12 | ✓ done |
| T3 | `CitrusClient` and `CitrusProvider` (R3, R4) | T1 | Contract and error tests | ✓ done |
| T4 | `esim` and `webhook-event` persistence (R11) | T1 | AC of R11 | ✓ done |
| T5 | Equivalent bytes, `processCumulative`, reading loop (R6, R7) | T1, T4 | AC of R6, R7 | ✓ done (R6 to be validated in T9) |
| T6 | `FundingService` (R5) and `PolicyEnforcer` without `set_data_limit` (R8) | T3, T4, T5 | AC of R5, R8 | ✓ done |
| T7 | `SessionCloser` (R9) and reused reconciliation (R13) | T5, T6 | AC of R9, R13 | ✓ done |
| T8 | Minimal webhooks (R10) | T4, T7 | AC of R10 | ✓ done |
| T9 | Real smoke test (§10) | T2 to T8 | Full cycle executed and documented | **pending** (requires real money, C7) |
| T10 | Retire Telnyx and update docs (R15) | T9 | AC of R15 | ✓ done |

## 10. Smoke test (T9)

With real money (C7). Before running it, confirm in the dashboard the cost of the eSIM and the minimum top-up (see §12). Cycle: 1 provisioned eSIM, funding of $9, installation, real usage, `defund`, `esim.defunded`, comparison of `charged − baseline` against `funded − returned`. It must validate the accuracy of `total_data_charged_usd`, the webhook signature format and the detection of the end of the `defund`.

## 11. Implementation notes

- Treat `wallet_balance_usd` as "at least" that balance (C5). Funding amounts in whole cents.
- Convert the API's USD to `bigint` micro-USD in one single place (the edge of `CitrusProvider`); no `float` further in.
- The key and the secret are never logged; mask `Authorization`.
- Only one active channel per eSIM at a time.
- Every decision that depends on usage or balance tolerates data up to ~15 min old.

## 12. Open questions and risks

1. **Real costs.** The README says "first eSIM free, USD 2.45 after" and "minimum top-up USD 4"; the reseller API documentation says **$1.75 per eSIM** and **$10 minimum top-up**. Confirm in the dashboard before budgeting T9.
2. **Accuracy of `total_data_charged_usd`** (the README already asks to confirm it): cents, or down to the KB. It is validated in T9.
3. **End of `defund` without a webhook.** The API does not document a pending `defund` indicator in `GET /esim/{iccid}`. Define the backup polling (wallet at 0 and stable usage?) and its timeout in T9.
4. **Webhook signature format** (hex, base64 or with a prefix). Covered by the tolerant comparison of R10; confirm with `POST /webhooks/{id}/test`.
5. **`USDC_USD_RATE_BPS`.** 1 USDC = 1 USD is assumed. Confirm or quote.
6. **"Equivalent bytes" vs the README's "country rate"** (§6.2): the formula is equivalent in billing and avoids maintaining per-country rates. Confirm with the team that real MB do not need to be shown to the traveler.
7. **Close port.** **Resolved:** the `SessionCloser` (R9) uses the existing close flow of the collection server (final voucher → channel close) without modifying its port; it orchestrates `refundUnused` + webhook + last voucher from the session service.
8. **`NetworkDataMeter`.** **Resolved:** the gateway simulator (`demo-meter.ts`) remains only as the base of `processTraffic` for the demos; in Citrus mode real usage arrives through `getUsage` (§6.2) and the policy is R8 (suspend/noop).
9. **Delay risk (C3).** Mitigated by the prepaid wallet (I2), but a traveler can consume up to ~15 min of data before the meter sees it; that is why the wallet cap is the primary protection and the `PolicyEnforcer` only a backup.
10. **New provider.** No visible SLA; no sandbox. Keep `FakeProvider` for development and demos.

## 13. References

- Technical brief: `citrus-mobile-brief.md`
- OpenAPI: https://citrusmobile.com/openapi-reseller.yaml
- Docs in Markdown: https://citrusmobile.com/developer/docs/markdown
- Recipes: https://citrusmobile.com/developer/guides
- Official MCP (rates and docs without a key): `https://citrusmobile.com/api/mcp`
- Public rates: https://citrusmobile.com/rates
- Support: support@citrusmobile.com
