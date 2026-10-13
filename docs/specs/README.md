# Specs: bring astroam-monad to the technical level of astroam-solana

Agreed on 2026-10-13. The goal is parity with
[astroam-solana](https://github.com/FrancoDuran23/astroam-solana) in what the
project can do and prove, adapted to Monad rather than copied from Solana.

Each spec is implemented on its own and lands as one commit on
`feat/solana-parity`. Specs in the same wave do not touch the same files and
can run in parallel; a later wave starts when the earlier one is integrated.

| # | Spec | Wave |
|---|---|---|
| 01 | [Escrow v4: operator separate from payee](01-escrow-v4-operator.md) | 1 |
| 02 | [Channel locks on mission operations](02-channel-locks.md) | 1 |
| 03 | [Frontend: payments only on chain](03-frontend-onchain-payments.md) | 1 |
| 04 | [Hosting files](04-hosting.md) | 1 |
| 05 | [Rail for escrow v4](05-rail-v4.md) | 2 |
| 07 | [Frontend: refund after the timeout](07-frontend-timeout-refund.md) | 2 |
| 08 | [Deploy script and real-run preflight](08-deploy-and-preflight.md) | 2 |
| 11 | [A claim collects what was used](11-claim-bounded-by-usage.md) | 3 |
| 12 | [Three fixes in how a trip closes](12-close-path-fixes.md) | 3 |
| 06 | [Mission log](06-mission-log.md) | 3 |
| 09 | [README and documents](09-readme-and-docs.md) | 4 |
| 10 | [English everywhere](10-english.md) | 5 |

## Decisions that shape every spec

- **The traveler keeps signing the vouchers.** The operator can never collect
  more than the traveler's session key authorized. The Solana model (the meter
  signs, a `checkpoint` instruction stores the attested total) is not ported:
  on Monad `claim` already records on chain what was collected.
- **Escrow v4 replaces v3.** There is no code path for v3 after spec 05; v3
  stays in the deployment record as a previous version.
- **Persistence stays as JSON files under `DATA_DIR`**, as in astroam-solana.
  A host without a disk loses missions and vouchers on restart; that is a
  documented limit of the testnet demo.
- **Outside explicit demo mode a payment is always a transaction.**
- **Nobody working from these specs handles a private key or deploys.** The v4
  testnet deploy, the end-to-end testnet run, the Render and Vercel setup and
  the video are done by the team afterwards.

## Not to merge into `main` yet

After spec 05 the branch targets an escrow v4 that is not deployed on Monad
testnet. Merge only once v4 is deployed and its address is recorded.
