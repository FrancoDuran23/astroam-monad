# 13 — Mission log gaps

Runs after spec 06.

## Why

Spec 06 ported astroam-solana's mission log, but the log starts at the eSIM.
The purchase itself (the traveler's deposit into the escrow), a top-up
payment and the steps that fail leave no entry, so a run cannot be traced
from the money that came in. A tranche recovered after a crash is added to
`fundedCents` with no entry either. And the evidence file astroam-solana keeps
in `docs/evidence/` was written by hand; Monad's real run needs a way to
produce it.

## Scope

- `src/product/persistence/MissionLog.ts` (event types)
- `src/product/persistence/MissionLogEvidence.ts` and its test (new)
- `src/product/services/MissionProductService.ts`
- `src/product/mission-log.test.ts`
- `scripts/dump-mission-log.ts` (new), `package.json`
- `README.md`, `docs/specs/06-mission-log.md`, `docs/specs/README.md`,
  `docs/real-esim.md`, `docs/deploy.md`

Backend only. No frontend view.

## Requirements

1. New event types:

   | Event | Recorded when | Data |
   |---|---|---|
   | `mission.created` | the trip is created | destination id, budget, duration in days |
   | `escrow.deposit` | the deposit is confirmed on the chain (the purchase) | txHash, channelId, depositAtomic, traveler address |
   | `escrow.topup` | a top-up payment is confirmed on the chain | txHash, addedAtomic, depositAtomic |
   | `esim.provision_failed` | activation fails before an eSIM exists (reseller balance or provider) | error code, short detail |
   | `esim.fund_failed` | a tranche or a top-up does not reach the eSIM wallet | source, amountCents, error code, short detail |

   `esim.funded` gains `source: 'recovered'` for a pending tranche that a
   later pass finds did reach the wallet.
2. Each entry is written after the change it describes is saved, as in spec
   06. A confirmation repeated for an already credited payment adds nothing.
3. Same rule as spec 06: amounts as digit strings in atomic units, never a
   key, a session key, a voucher signature, an API key or the activation code.
   An error detail is cut to 160 characters.
4. `MissionLogEvidence.ts` formats one trip's entries as the evidence text
   astroam-solana keeps: a header, a table of events and the raw JSON lines,
   with the ICCID's middle digits hidden.
5. `npm run log:dump -- <missionId> [--out <file>]` reads
   `DATA_DIR/mission-log.jsonl` and prints or writes that text. Read-only.
6. Not covered: a trip due to close with no voucher is reported by the logger
   on every pass and is not logged per trip, so the log does not grow by one
   line per tick.

## Tests

- A full demo trip records `mission.created` and `escrow.deposit` before the
  eSIM events, and the deposit entry carries the deposit's transaction hash.
- Confirming the same deposit or top-up twice records it once.
- A top-up records `escrow.topup` and the `esim.funded` it caused.
- A failed activation records `esim.provision_failed`; a failed tranche
  records `esim.fund_failed`; a recovered tranche records
  `esim.funded` with `source: 'recovered'`.
- The no-secrets test covers the new events.
- The evidence text hides the ICCID and lists every entry in order.

## Done when

`npm run check` and `npm test` pass.
