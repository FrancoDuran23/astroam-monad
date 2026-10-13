# 09 — README and documents

Runs after specs 01 to 08: it describes what they built and quotes the test
counts of the finished code.

## Why

astroam-solana's README has 23 sections and answers what a reviewer asks:
what the problem is, where it runs, how to try it, what to trust, what is
real. astroam-monad's has 9. The team wants the same sections here, with
Solana replaced by Monad.

## Scope

- `README.md`
- `docs/validation.md`, `docs/go-to-market.md`, `docs/test-verification.md`,
  `docs/real-esim.md` (new, adapted from astroam-solana)
- `docs/decisions/fund-flow-architecture.md`, `docs/decisions/automate-fund-flow-issues.md`,
  `docs/monad-e2e-test-report.md`
- `docs/img/` for images the copied sections reference
- Delete `docs/estado-del-proyecto.md` and
  `docs/registro-sesion-2026-10-03.md`: both are out of date

No source code changes.

## The one rule

Every statement in the README must be true of astroam-monad today. Text may
be carried over from astroam-solana where it describes the product; anything
that describes a fact of the Solana deployment is replaced with the Monad
fact, or with a visible pending note when the Monad fact does not exist yet.

## Requirements

1. **Sections, in astroam-solana's order:** live demo and deployment (with
   the walkthrough for judges), demo video, video pitch, problem, solution,
   why Monad, the deployed contract, architecture (team and roles, custody
   and keys), trust model, try it in 5 minutes, test with your own deploy,
   automatic fund flow (with the mission log), go-to-market and validation,
   what is real and what is not, roadmap, checks and test verification.
   Keep what the current README has that astroam-solana lacks: prior work,
   pricing, the screenshots.
2. **Pending notes.** A visible block, not an HTML comment, in exactly these
   places:
   - Live demo: frontend and API URLs to be added once deployed on Vercel and
     Render (`docs/deploy.md`).
   - Deployed contract: the v4 address and the table of transactions for a
     full run (approve, deposit, claim, close) to be added after the v4
     testnet deploy and run. Until then show v3's address and the
     2026-10-07 run from `docs/monad-e2e-test-report.md`, labelled as the
     previous version.
   - Real eSIM: the run with a real eSIM on 2026-10-09 was done with the
     Solana build of the same backend; link to that evidence in
     astroam-solana and say a run settled on Monad is still to be done.
3. **Videos.** Keep the video sections pointing at the existing videos, as
   in astroam-solana; the team replaces them later.
4. **Why Monad.** Written for this project: EVM tooling and EIP-712 typed
   signatures for vouchers, a session key in the browser, gas low enough to
   claim often so little is ever owed off chain, fast finality for deposit
   confirmation. Each point must be one the code actually relies on.
5. **Trust model**, with a diagram, for escrow v4:
   - who holds what: traveler wallet, session key in the browser, operator
     key on the server, payee;
   - what each can and cannot do, including a stolen operator key (can close
     channels early at the claimed amount; cannot take funds) and a traveler
     who stops signing (the exposure is one funding tranche);
   - what is still trusted: AstroAm's usage metering, the provider's usage
     figures, the server holding the latest voucher until it is claimed;
   - the plan: payee as a multisig.
6. **What is real, and what is not.** Testnet USDC, the eSIM provider mode
   used in the recorded runs, no database, state lost on restart on a host
   without a disk, v4 not yet deployed.
7. **Test verification** (`docs/test-verification.md` and a README summary):
   the commands, the date, and the counts actually obtained by running the
   backend suite, the frontend suite and the Foundry suite on this branch.
   Report failures and skips as they are.
8. **Validation and go-to-market.** Adapt astroam-solana's documents and the
   images they use. They describe the product and the market, so the content
   carries over; remove or reword anything tied to Solana.
9. **Fund-flow documents.** Update for v4: operator and payee, no treasury
   sweep, the mission log. Bring in the 2026-10-07 note on Citrus auto-refill
   from astroam-solana's `docs/decisions/` if the Monad documents lack it.
10. Every relative link in the README and in `docs/` resolves.

## Done when

- A reader can tell from the README alone what is deployed, what is pending
  and who does it.
- No sentence claims a Monad deployment, transaction, test count or real-eSIM
  run that does not exist.
- A link check over `README.md` and `docs/**/*.md` finds no broken relative
  link.
