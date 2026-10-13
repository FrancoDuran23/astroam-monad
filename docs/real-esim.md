# From a sample eSIM to a real one

**Date:** 2026-10-13 · **Status:** no run with a real eSIM has settled on Monad. The public demo, once hosted, stays on the sample profile.

> **PENDING: a real-eSIM run on Monad.** A run with a real Citrus eSIM was done on 2026-10-09, but with the **Solana build** of the same backend, not with this repository's Monad escrow. Its evidence is in astroam-solana: [docs/real-esim.md](https://github.com/FrancoDuran23/astroam-solana/blob/main/docs/real-esim.md#run-of-2026-10-09) and its [mission log](https://github.com/FrancoDuran23/astroam-solana/blob/main/docs/evidence/2026-10-09-real-esim-mission-log.txt). Nothing from it is copied here as Monad's. A run settled on Monad testnet is still to be done by the team, after the escrow v4 deploy, following [One controlled real run](#one-controlled-real-run). Its explorer links and its mission log will be added to this page and linked from the README.

## What the Solana run showed

Only what astroam-solana records, and about the Solana build: the flow issued a real Citrus eSIM, a team member used it on a phone, a usage reading from Citrus became a voucher, and the trip closed on Solana devnet with the rest refunded. It was one run by a team member, not a traveler on a trip. It says nothing about the Monad escrow, and the Monad flow differs: here the traveler's session key signs the vouchers, not a meter key.

## What is simulated today on Monad

| Piece | Today | What makes it real |
|---|---|---|
| eSIM profile | `FakeProvider` returns a sample profile. No line is issued. The 2026-10-07 testnet run ([report](reporte-prueba-e2e-monad.md)) shows an LPA string with `fake.smdp`: a sample. | `CONNECTIVITY_PROVIDER=citrus` and `CITRUS_API_KEY`, plus the variables below. |
| Usage | The demo-traffic button injects traffic (`ENABLE_DEMO_TRAFFIC=true`, the default). | `ENABLE_DEMO_TRAFFIC=false`. Usage is then what Citrus reports for that eSIM. |
| Prices in the app | A fixed table of sample rates per country. | Read `GET /rates` from Citrus. Not built. |
| USDC | Circle's testnet USDC. It has no value. | Mainnet. Out of scope for the hackathon. |
| Collected USDC to dollars | Nothing moves. The escrow pays the payee address. | A manual conversion by the operator, or an offramp account. See D-1 in [the fund-flow architecture](arquitectura-flujo-de-fondos.md). |

Two pieces are real but could be mistaken for simulated: the rules in the app that warn about the budget call no model, and with `PAYMENT_RAIL=monad` the USDC moves through the `AstroAmEscrow` contract, not through any in-memory rail. With `PAYMENT_RAIL=fake` nothing moves on chain, and outside demo mode the app then shows "payments are not available".

## Why the Citrus key alone is not enough

With `CONNECTIVITY_PROVIDER=citrus` and a valid key the API creates a real eSIM, and Citrus charges $1.75 for it. That eSIM starts with a $0 wallet, and a $0 wallet passes no data.

The API funds the eSIM only for a deposit it has confirmed on chain. After the first tranche, the next ones are funded only as the traveler's vouchers cover what was already funded, and the vouchers are signed by the session key in the traveler's browser. Without the operator key the backend can neither claim nor close the trip: the traveler would get the deposit back only through the contract's refund after the timeout.

So a working line needs all of these on the same API process:

| Variable | Why |
|---|---|
| `PAYMENT_RAIL=monad` and `MONAD_ESCROW_ADDRESS` | The deposit is read from the escrow on chain. |
| `MONAD_OPERATOR_PRIVATE_KEY` | The escrow's `operator()` (or its payee). It sends `claim` and `close`, and never receives USDC. |
| `CONNECTIVITY_PROVIDER=citrus` and `CITRUS_API_KEY` | Selects the real provider. |
| `ENABLE_DEMO_TRAFFIC=false` | Removes the button that invents traffic. |
| `CITRUS_WEBHOOK_SECRET` and `FRONTEND_ORIGIN` | `npm run real:check` requires them. With real Citrus the origin must be local (`localhost`, `127.0.0.1` or a private LAN address): testnet funds are free, so on a public app anyone could spend the reseller's balance. Leave `ASTROAM_LIVE_ENABLED=false`; the check does not require live mode. |

Known limit: with `ASTROAM_LIVE_ENABLED=true` the API asks for `Authorization: Bearer <ASTROAM_DEMO_ACCESS_TOKEN>` on every route that changes data, and the frontend in this repository sends no such header. Against an API in live mode the app's calls that create or change a mission are answered with 401. A run through the app today therefore needs either the frontend to send the token or the run to drive the API directly. For a run through the app, keep live mode off (the preflight does not require it).

## Known limit: one eSIM per user reference

The frontend sends one fixed user id (`usr_astroam`) when it creates a mission, and the Citrus provider reuses an existing eSIM for the same user reference. Today every trip against real Citrus therefore shares one eSIM. That is fine for a single tester and wrong for two travelers at once.

## One controlled real run

Run it on a laptop, not on a public URL (see the next section). Nothing below has been run on Monad.

1. Check the Citrus reseller balance. The run needs $1.75 for the eSIM and $2.50 for the first tranche; keep a margin (`npm run real:check` requires at least those two).
2. Deploy escrow v4 and set the variables above in a local `.env`. The steps are in the README under "Test with your own deploy". For a short test, also set `CLAIM_MIN_USDC=0.5` so a claim happens with little usage.
3. Run `npm run real:check`. It reads the chain and the Citrus balance, one line per check, and spends nothing.
4. Start the API with `npm run server`. The log should say `payment rail operator ready`, not `payment rail cannot collect or close`.
5. In the app, start a mission with a 5 USDC budget and pay from the wallet on Monad testnet. At the 1.5x markup 5 USDC pays for $3.33 of eSIM wallet, enough for one full tranche.
6. Scan the QR with a phone. It is a real install code now. Citrus covers Argentina, so the test can be done at home.
7. Use some data. Citrus reports usage with a delay of the order of ten minutes (as recorded in astroam-solana's run; not yet observed on Monad), so the first reading takes a while.
8. When usage shows, the app signs vouchers and the backend claims what was used once it reaches `CLAIM_MIN_USDC`. End the trip in the app. The close pays what was used to the payee and refunds the rest to the traveler.
9. Write down the ICCID with the middle digits hidden, the usage Citrus reported, and the explorer links of the deposit, a claim and the close. Link them from the README. The mission log (`GET /api/missions/:id/logs`, spec 06) is the dump to attach.

What the run costs in real money: $1.75, plus whatever data is used. The part of the tranche that is not used goes back to the reseller balance when the trip closes. The USDC is testnet USDC.

## Do not put the Citrus key on the public demo

Testnet USDC is free from a faucet. A public API holding a Citrus key would let anyone deposit free USDC and spend real reseller dollars: $1.75 per eSIM and up to a tranche each. The hosted demo therefore stays on the sample profile (`docs/deploy.md` says the same), and a real eSIM is shown with a recorded run.

Charging real money for real data needs mainnet USDC, and with it an audit of the contract, the payee as a multisig, and a legal review.

## What would still not be real after that run

- **Prices.** The traveler is charged what Citrus charged, times 1.5. The table in the app is a sample: it follows Citrus's cheapest network per country, and a phone can connect to a dearer one.
- **Speed of usage.** A reading takes minutes to arrive, so the balance on screen lags.
- **State across restarts.** Missions and vouchers are JSON files under `DATA_DIR`, lost on a host without a disk. A deposit confirmation no longer depends on process memory.
- **Dollars.** Collected USDC stays with the payee address until someone converts it.
