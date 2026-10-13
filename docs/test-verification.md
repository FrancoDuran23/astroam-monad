# AstroAm on Monad: test verification

**Date:** 2026-10-13
**Code under test:** commit `5293efc` of branch `feat/solana-parity` (spec 12 of `docs/specs/`). The documentation commit that adds this file changes no code, so these figures describe the same code.
**Status:** all suites pass, with no failing and no skipped test.

> **These figures are "as of commit `5293efc`".** The backend count is expected to rise when the mission log (spec 06) and the close-path fixes (spec 12) land on this branch, which were being implemented separately while this page was written. Whoever merges them refreshes the table below by running the commands in section 1.

## 1. Commands and results

Run from a clean checkout, in this order, on Linux with Node v26.7.0 (the project requires Node 22.18 or newer) and Foundry `forge 1.8.4`:

```bash
export PATH="$HOME/.config/.foundry/bin:$PATH"   # where Foundry was installed here
npm ci --no-audit --no-fund
npm run contracts:build
npm run check
npm test
forge test --root contracts

cd frontend
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
```

| Target | Command | Result |
|---|---|---|
| Contract build | `npm run contracts:build` | Built. Foundry prints lint warnings about `block.timestamp` after `vm.warp` in `contracts/test/AstroAmEscrow.t.sol`; they are warnings in the test file, not errors. |
| Backend typecheck | `npm run check` | 0 errors (`tsc --noEmit`) |
| Backend tests | `npm test` | **339 tests, 339 passed, 0 failed, 0 skipped**, 29.5 s |
| Contract tests | `forge test --root contracts` | **61 tests, 61 passed, 0 failed, 0 skipped** |
| Frontend typecheck | `npm run typecheck` (in `frontend/`) | 0 errors |
| Frontend tests | `npm test` (in `frontend/`) | **36 tests, 36 passed, 0 failed, 0 skipped**, 8 suites |
| Frontend build | `npm run build` (in `frontend/`) | Built in 5.2 s. Vite warns that one chunk is larger than 500 kB after minification; the build still succeeds. |

Total: 436 tests, all passing.

## 2. What the suites cover

- **Contract (Foundry).** `AstroAmEscrow` v4: deposit, top-up, `claim` with a `claimTotal` bounded by the voucher, `close`, timeout `refund`, the operator and the payee as separate accounts, `setOperator`, who is rejected with `NotOperator`, malformed and malleable signatures, a voucher from another key, settlement above the voucher or below what was claimed, any operation on a settled escrow. One test pins the EIP-712 voucher digest that the TypeScript helper must also produce.
- **Backend.** The payment rails (`FakeRail`, which now rejects what the contract rejects, and `MonadRail` against a local chain), deposit confirmation without memory, per-mission channel locks, the automatic fund flow (tranches, claims bounded by usage, automatic close), the readiness check of the operator key and the preflight rules, the HTTP API, the Citrus client, webhooks and balance guard, and the ABI check against the contract build.
- **Frontend.** The session-key and voucher logic, the rule for when a payment is simulated, blocked or on chain, and the rule for the timeout refund window. These are unit tests of the logic.

## 3. What these runs do not show

- No test was run against a deployed contract: escrow v4 is not deployed, and no run of the finished code on testnet has been recorded. The only testnet run is the 2026-10-07 one on v3 ([report](reporte-prueba-e2e-monad.md)).
- The wallet flows in the frontend (deposit, top-up, refund after the timeout) were verified by unit tests of their logic. They were not recorded in a browser against v4.
- The Docker image has never been built: no Docker access was available where this was written. The same server was started directly with Node.
- There is no hosted deployment, so there is no live check of a hosted API or app.
- No run with a real Citrus eSIM has settled on Monad ([real-esim.md](real-esim.md)).

## 4. How to check the contract and the ABI

`npm run contracts:abi` regenerates `src/shared/monad/abi.ts` from `contracts/out` after a build. A test fails if the committed ABI differs from the build output, and is skipped only when `contracts/out` does not exist; the run above had a fresh build, so it ran.
