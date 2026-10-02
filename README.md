# AstroAm

**Mobile data in any country, paid per MB in USDC. Pay for what you use; get the rest back.**

The traveler deposits USDC into a payment channel and installs one eSIM. As the
carrier meters their data, each reading gets a signed cumulative voucher — no
transaction per megabyte. When the trip ends, one transaction pays AstroAm the
latest voucher and the channel returns the rest of the deposit to the traveler.

Built for **Monad Metropolis 2026** (track: Consumer Products & Payments) by
[@FrancoDuran23](https://github.com/FrancoDuran23), [@DanielPalermoo](https://github.com/DanielPalermoo),
[@ignaMartin22](https://github.com/ignaMartin22) and [@Joel010999](https://github.com/Joel010999).

![AstroAm landing](docs/img/00-landing.png)

<table>
  <tr>
    <td><img src="docs/img/01-destination.png" width="170" alt="Pick a destination"></td>
    <td><img src="docs/img/02-deposit.png" width="170" alt="Deposit USDC"></td>
    <td><img src="docs/img/03-esim.png" width="170" alt="Install the eSIM"></td>
    <td><img src="docs/img/04-trip.png" width="170" alt="Trip dashboard"></td>
    <td><img src="docs/img/05-settled.png" width="170" alt="Trip settled"></td>
  </tr>
  <tr><td>Destination &amp; rate</td><td>Deposit</td><td>eSIM</td><td>Trip</td><td>Settled</td></tr>
</table>

## Status — read this first

| Part | State |
|---|---|
| App (landing + trip flow), mission API, metering, cutoff policy, vouchers | **Working**, end to end, with simulated payments and a simulated eSIM |
| Payment channel on Monad (contract + rail) | **In progress** — the app runs on `FakeRail` until it lands |
| Citrus Mobile eSIM provider | Implemented, **not yet tested against the real API** (no sandbox; needs a funded reseller account) |

Everything simulated is labeled in the UI ("Simulated payments", "Simulated QR").

## Prior work

This repository starts from AstroAm's base built for another hackathon
(Stellar), imported unchanged in the first commit
([`0ae9756`](https://github.com/FrancoDuran23/astroam-monad/commit/0ae9756)).
Everything after it is new work for Metropolis: Stellar was removed, payments
were moved behind a chain-agnostic `PaymentRail`, the frontend was redesigned
(WebGPU shaders with [vgpu](https://github.com/vercel-labs/vgpu)), and the
Monad payment channel is being added.

## How it works

1. **Pick a destination and a budget.** Each country has its own per-MB rate,
   shown up front (Brazil: 0.0025 USDC/MB, so 5 USDC ≈ 2 GB).
2. **Deposit USDC.** It goes into a one-way payment channel, not to us. Only a
   signed voucher can move it.
3. **Install the eSIM.** One QR or LPA code; it stays on the phone for the next trip.
4. **Browse.** Each usage reading from the carrier gets a voucher for the
   running total. If the deposit can't cover a reading, the voucher is refused
   (`channel_exhausted`) and data pauses.
5. **End the trip.** One transaction settles the latest voucher and refunds the rest.

## Architecture

```
src/
  rails/        PaymentRail port + FakeRail (in-memory); the Monad rail goes here
  product/      mission API used by the app (/api/missions …)
  meter/        meter: asks for a voucher per reading, credits data only when signed
  services/     cutoff policy, eSIM wallet funding, session close, Citrus webhooks
  providers/    eSIM providers: CitrusProvider (real) and FakeProvider (demo)
  jobs/         usage reconciliation against the carrier
  persistence/  eSIM records and webhook log (JSON files)
  shared/       money math (BigInt), voucher message schemas, retries, network ids
  server/       HTTP app: /health, /ready, /api, /citrus/webhooks
frontend/       React + Vite + Tailwind; WebGPU shaders in frontend/src/gpu
```

`PaymentRail` (`src/rails/PaymentRail.ts`) is the only place that knows about
a chain: create a deposit intent, confirm it (the deposit opens the channel),
read the channel deposit, sign vouchers, close and refund. Amounts are BigInt
in an internal raw unit (1 raw = 1e-7 USDC); each rail converts to its token's
decimals.

The frontend has two WebGPU pieces, both with a CSS fallback for browsers
without WebGPU and a still frame for reduced motion:

- `signal-field.wgsl` — the landing background: a nebula and signal waves that follow the pointer.
- `data-stream.wgsl` — the trip balance: a tank that drains as data is used, packets that speed up on each reading.

## Pricing

Citrus Mobile's public pay-as-you-go rate per country × 1.35.

| Country | Citrus (USD/GB) | AstroAm (USD/GB) | USDC/MB |
|---|---:|---:|---:|
| Brazil | 1.84 | 2.48 | 0.0025 |
| Argentina | 1.89 | 2.55 | 0.0026 |
| Mexico | 2.00 | 2.70 | 0.0027 |
| United States | 0.97 | 1.31 | 0.0013 |
| Spain, Italy, France, UK | 0.61 | 0.82 | 0.0008 |

Rates from [citrusmobile.com/rates](https://citrusmobile.com/rates), checked 2026-09-23.

## Run it locally

Node ≥ 22.18. No keys needed.

```bash
cp .env.example .env
npm install
npm run server                              # API on http://localhost:8080

cd frontend && npm install && npm run dev   # app on http://localhost:5173
```

Leave `frontend/.env` out: Vite proxies `/api` to the backend. On the trip
screen, **Use 250 MB** simulates a carrier reading (5 USDC in Brazil runs out
after 8).

Checks: `npm test` and `npm run check` (backend), `npm test` and `npx tsc --noEmit` (frontend).

## Risks, stated plainly

- **Citrus reports usage in USD charged, not bytes.** Bytes are derived from the
  country rate; accuracy needs confirming on a real account.
- **No carrier sandbox.** Every Citrus API test costs real money (minimum top-up USD 4).
- **Citrus also sells directly to travelers, cheaper than us.** We compete on
  paying in USDC without a card and on the automatic refund, not on price.
- **~10 minutes between usage and voucher.** Bounded by the eSIM's prepaid wallet.
- **No audit** of the code or the contract.

## Documents

| Read | For |
|---|---|
| [`docs/decisiones/medicion-con-proveedor.md`](docs/decisiones/medicion-con-proveedor.md) | Why usage is metered by the carrier, not by our own gateway (Spanish). |
| [`docs/citrus-mobile-brief.md`](docs/citrus-mobile-brief.md), [`docs/citrus-mobile-spec.md`](docs/citrus-mobile-spec.md) | The Citrus Mobile integration (Spanish). |
