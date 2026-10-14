# Deployments of `AstroAmEscrow` on Monad testnet

Network: Monad Testnet (chain id 10143). Circle USDC (6 decimals):
`0x534b2f3A21130d7a60830c2Df862319e593943A3`. Refund timeout in both
versions: 2,592,000 s (30 days).

The contract is immutable: each version is a new address. The current one is
the one in `MONAD_ESCROW_ADDRESS`.

| Version | Address | Date | Deploy tx | Payee | Notes |
|---|---|---|---|---|---|
| v1 | `0xc6ead43fdf838198854f7811658cc4edd50f7a0f` | 2026-10-03 | [`0x1c81…2bbb`](https://testnet.monadvision.com/tx/0x1c810803b012fab6598c39e492c1b8aab83fe92fc05d1d98440aae5bb9142bbb) | `0x441D3f2b790bE54dd55C3D47778D3E0385064b40` | No `claim`. Replaced by v2. |
| v2 | `0xb357ef379227c4113d3dc439af587437ff3e8292` | 2026-10-05 (22:13 ART, 2026-10-06 01:13 UTC) | [`0xc09f…8daa`](https://testnet.monadvision.com/tx/0xc09f2289c4b0fcab0ff52b6d054bcfff1f2def634c4e33533b488d7c5c2e8daa) | `0x441D3f2b790bE54dd55C3D47778D3E0385064b40` | With `claim`. Replaced by v3 to use the new payee. |
| v3 | `0xe89893d51180e517e2bf175398aad2e6da82c0f9` | 2026-10-06 (22:46 ART, 2026-10-07 01:46 UTC) | [`0x5a8c…7a0b`](https://testnet.monadvision.com/tx/0x5a8c225be99ac3bf4f35eb2c0356b9d76808e1750a9cd2db3113915017327a0b) | `0xE3E38BE1522E2086B135cb9e9b3D223708485316` | With `claim`. Payee is our own operator. Replaced by v4. |
| **v4 (current)** | `0x89738331BadF0cb4278c21DE4D282dC24EE2987d` | 2026-10-14 (00:05 UTC) | [`0x69ec…2ae0`](https://testnet.monadvision.com/tx/0x69ec605d0242eb757248618454fee3b0335dddd958186de3e4cb4e29ff432ae0) | `0xb8ec7Fe73740eeC5Bc3E85E414562AfCd8056b61` | Separated operator & bounded claims. [View on the explorer](https://testnet.monadvision.com/address/0x89738331BadF0cb4278c21DE4D282dC24EE2987d). |

Full txs: v1 `0x1c810803b012fab6598c39e492c1b8aab83fe92fc05d1d98440aae5bb9142bbb`,
v2 `0xc09f2289c4b0fcab0ff52b6d054bcfff1f2def634c4e33533b488d7c5c2e8daa`,
v3 `0x5a8c225be99ac3bf4f35eb2c0356b9d76808e1750a9cd2db3113915017327a0b`,
v4 `0x69ec605d0242eb757248618454fee3b0335dddd958186de3e4cb4e29ff432ae0`.

## What changed from v1 to v2

- **`claim(escrowId, voucherAmount, signature)`**, payee only: pays
  `voucherAmount - claimed` and leaves the escrow open. Emits
  `Claimed(escrowId, amount, totalClaimed)`.
- **`close`** reverts with `SettleBelowClaimed` if `settleAmount` is less than
  what was already collected. If it closes exactly at what was collected, no
  new voucher is needed.
- **`Closed.paid`** is the total paid, claims included: `paid + refunded` is
  the deposit.
- **`refund`** returns `deposit - claimed`, and the timeout runs from the last
  activity (deposit, `topUp` or `claim`, stored in `lastActivityAt`), not
  from `openedAt`.
- **`escrows()`** returns 7 fields: `claimed` and `lastActivityAt` go at the
  end, so the first five do not change.
- **Vouchers:** same format and same EIP-712 domain (`name: AstroAmEscrow`,
  `version: 1`), but the `verifyingContract` is the new address. A v1 voucher
  is not valid on v2.

## Open escrows on v1

At the time of the change none was left open. All the missions in the old
data were completed or cancelled; the two that were still in
`pending_payment` were checked on-chain: one was already settled (it had been
refunded earlier) and the other never received a deposit.

If something showed up on v1:

- **Close it:** `MONAD_ESCROW_ADDRESS=0xc6ead43fdf838198854f7811658cc4edd50f7a0f npm run monad:close-escrow -- 0x<escrowId> --send`.
  The script falls back to v1's getter if the contract does not have the new
  fields.
- **Or let it return to the traveler:** `refund()` returns the whole deposit
  30 days after the deposit.

Vouchers are stored per contract address
(`DATA_DIR/monad-vouchers-<escrow>.json`), so they are not migrated: those of
v1 stay in their file and serve only to close v1 escrows.

## v4

| Version | Address | Date | Deploy tx | Payee | Operator |
|---|---|---|---|---|---|
| v4 | `0x89738331BadF0cb4278c21DE4D282dC24EE2987d` | 2026-10-14 (00:05 UTC) | [`0x69ec…2ae0`](https://testnet.monadvision.com/tx/0x69ec605d0242eb757248618454fee3b0335dddd958186de3e4cb4e29ff432ae0) | `0xb8ec7Fe73740eeC5Bc3E85E414562AfCd8056b61` | `0xb8ec7Fe73740eeC5Bc3E85E414562AfCd8056b61` |

What changed from v3, and why:

- **The server key is no longer the payee.** In v3 one account was both the
  payee and the only caller of `claim` and `close`, so a stolen server key was
  stolen funds, and a job swept the payee to a treasury afterwards. In v4 the
  constructor is `(usdc, payee, operator, timeoutSeconds)`: the server key is
  the `operator`, it only sends transactions, and the contract pays the payee
  directly. The payee can be a cold wallet or a multisig.
- **`claim` and `close` accept the operator or the payee** and always pay the
  payee. Anyone else reverts with `NotOperator`.
- **`setOperator(address)`**, callable only by the payee, rotates the server
  key without redeploying. It emits `OperatorChanged`.
- **Bound on a compromised operator:** it can close a channel early with what
  was already claimed, refunding the traveler. It cannot move funds anywhere
  except to the payee and the traveler.
- **`claim` takes a `claimTotal`:** `claim(escrowId, voucherAmount, signature,
  claimTotal)`. The app signs vouchers ahead of usage, so a voucher is a
  ceiling, not a bill. In v3 a claim paid the payee the whole voucher: the
  traveler was charged for data not used, and a trip that ended with usage
  below what was claimed could not be closed (`SettleBelowClaimed`). Now the
  payee is paid up to `claimTotal`, the usage so far: above what was already
  claimed (`NothingToClaim`) and never above the voucher
  (`ClaimExceedsVoucher`). The rest of the voucher stays claimable with the
  same signature, and `close` at the used amount is never below the claimed
  total. The contract cannot know the usage: the voucher is still the only
  bound it enforces on whoever operates the channel.
- Vouchers, `deposit`, `topUp` and `refund` do not change. The EIP-712 domain
  is the same, but its `verifyingContract` is the new address, so a v3 voucher
  is not valid on v4. Open v3 escrows are closed or refunded as in the v1
  section above.

The deploy script refuses a payee equal to the operator (unless
`--allow-same-key`, for local testing), reads `usdc()`, `payee()`, `operator()`
and `timeoutSeconds()` back after deploying and fails on any mismatch. Run
`npm run real:check` afterwards.

## How to redeploy

1. Compile in WSL: `forge build --root contracts` (generates `contracts/out/`).
2. With MON in the deployer account, export the key only in the shell, never
   in a versioned file: `MONAD_DEPLOYER_PRIVATE_KEY=0x…`.
3. From Windows: `npm run monad:deploy`. The script aborts if the artifact in
   `contracts/out/` is old (without the `claim` function); in that case,
   repeat step 1.
4. Update `MONAD_ESCROW_ADDRESS` in `.env` (and the address in
   `.env.example` and the README) and restart the API.
5. Add the new row to the table above and note what happens to the escrows
   still open in the previous version.
