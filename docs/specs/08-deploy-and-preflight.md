# 08 — Deploy script and real-run preflight

Runs after spec 05.

## Why

The v4 deploy and the testnet run will be done by a teammate, from the
commands this spec leaves behind. The deploy script has gaps astroam-solana's
does not, and there is no preflight to tell that teammate everything is in
place before spending testnet funds or a real eSIM.

## Scope

- `scripts/deploy-monad-escrow.ts`
- `scripts/check-real-run.ts` (new) and `real:check` in `package.json`
- `.gitignore`, `.env.example`
- `docs/monad-deployments.md` (the record of deployments)

Reference: astroam-solana's `scripts/deploy-solana-escrow.ts` and
`scripts/check-real-run.ts`.

## Requirements

### Deploy script

1. Always runs `forge build` first; never deploys a stale artifact.
2. Takes the v4 constructor arguments. `MONAD_PAYEE_ADDRESS` (where the money
   goes) and `MONAD_OPERATOR_ADDRESS` (the server key's address) are both
   required; refuse to deploy when they are equal, with a message explaining
   that the point of v4 is keeping them apart. A `--allow-same-key` flag
   permits it for local testing.
3. Honours `MONAD_RPC_URL`, `MONAD_CHAIN_ID` and `MONAD_USDC_ADDRESS` the
   same way the rail does, and checks the RPC's chain id matches.
4. Before sending: the deployer has MON for gas, and the USDC address has
   code and reports 6 decimals. Stop with a clear message otherwise.
5. After deploying: reads back `usdc()`, `payee()`, `operator()` and
   `timeoutSeconds()` and fails loudly on any mismatch.
6. With `MONAD_ESCROW_ADDRESS` already set, it does not deploy: it verifies
   that contract's configuration against the environment and reports it.
   `--force` deploys a new one anyway.
7. Prints the lines to paste into `.env` and the explorer link. Never prints
   a private key.

### Preflight (`npm run real:check`)

Read-only. Sends no transaction, creates no eSIM, spends nothing. Prints one
line per check with pass or fail, and exits non-zero if any fails.

8. Chain: RPC reachable, chain id as expected, the escrow address has code,
   its `usdc()` matches the configured USDC, the configured operator key is
   the contract's `operator()` or `payee()`, the operator has MON for gas,
   and `payee()` differs from the operator's address (warning only).
9. Provider: `CONNECTIVITY_PROVIDER=citrus`, the API key is accepted, the
   reseller balance covers one eSIM (`CITRUS_ESIM_PROVISION_CENTS`) plus one
   funding tranche (`FUNDING_TRANCHE_CENTS`), the webhook secret is set.
10. Configuration: `PAYMENT_RAIL=monad`, `ASTROAM_LIVE_ENABLED=true`,
    `ENABLE_DEMO_TRAFFIC=false`, an access token set, `FRONTEND_ORIGIN` set
    and not a wildcard.
11. Split so the checks are testable without a network: pure functions that
    take the values read and return results, plus a thin layer that reads
    them. Test the pure functions.

### Housekeeping

12. `.gitignore` excludes key material that could end up in the tree:
    `*.key`, `*.pem`, `*-keypair.json`, `keystore/`, `.env.*` except
    `.env.example`, `contracts/broadcast/`.
13. `.env.example` documents `MONAD_OPERATOR_ADDRESS`, `MONAD_PAYEE_ADDRESS`
    and says which values the deploy prints.
14. `docs/monad-deployments.md`: add a v4 entry describing what changed from
    v3 and why, with the address and transaction marked as pending until the
    deploy is done. Keep v1 to v3 as they are.

## Done when

- `npm run check` and `npm test` pass.
- `npm run monad:deploy` with no environment prints usage and exits non-zero
  without touching the network.
- `npm run real:check` with the default `.env.example` values exits non-zero
  and lists which checks failed, without a stack trace.
