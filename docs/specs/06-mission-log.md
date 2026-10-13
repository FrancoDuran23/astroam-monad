# 06 — Mission log

Runs after spec 05.

## Why

astroam-solana keeps an append-only log per mission of what happened to the
eSIM, the data usage and the money, and serves it over HTTP. It is how a run
is shown to have happened (`docs/evidence/` there is a dump of it).
astroam-monad has no equivalent.

## Scope

- `src/product/persistence/MissionLog.ts` and its test (new)
- `src/product/services/MissionProductService.ts`,
  `src/product/runtime/product-boot.ts`, `src/product/api/routes.ts`
- API tests under `src/product/`

Backend only. No frontend view.

Port from astroam-solana's `src/product/persistence/MissionLog.ts`,
`MissionLog.test.ts`, the `record()` calls in its `MissionProductService.ts`
and the route in its `routes.ts`.

## Requirements

1. `MissionLog` interface with a file implementation (JSON lines in
   `DATA_DIR/mission-log.jsonl`, append only) and an in-memory one for tests.
   Each entry has a timestamp, the mission id, an event type and a small data
   object.
2. Event types, adapted to how Monad settles:

   | Event | Recorded when |
   |---|---|
   | `esim.provisioned` | the eSIM is created |
   | `esim.funded` | a funding tranche reaches the provider |
   | `esim.paused`, `esim.resumed` | the line is cut or restored |
   | `usage.baseline`, `usage.reading` | usage is read from the provider |
   | `usage.demo_traffic` | demo traffic is injected |
   | `voucher.received` | a traveler-signed voucher is accepted |
   | `escrow.claim` | a claim transaction is confirmed |
   | `mission.closed` | the escrow is closed or the mission cancelled |

   There is no `escrow.checkpoint` and no `voucher.signed` by the backend:
   on Monad the traveler's session key signs.
3. Entries carry amounts as strings in atomic units and transaction hashes
   where there is one. Never a private key, a session key, a voucher
   signature, an API key or the eSIM's activation code.
4. A failure to write the log never fails the operation it describes; it is
   reported through the existing logger.
5. `GET /api/missions/:id/logs` returns `{ missionId, entries }`, oldest
   first, 404 for an unknown mission, with the same access rule as
   `GET /api/missions/:id`.

## Tests

- File log: append, read back by mission, survives a new instance on the same
  directory, ignores a truncated last line.
- A full demo mission flow produces the expected sequence of event types.
- The route: 200 with entries, 404 for an unknown mission.
- No entry in a full flow contains a signature or the activation code.

## Done when

`npm run check` and `npm test` pass.
