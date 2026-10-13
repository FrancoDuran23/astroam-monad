# 01 — Escrow v4: operator separate from payee

## Why

In v3 one account is both the payee and the only caller of `claim` and
`close`. That key lives on the server, receives the USDC, and a job sweeps it
to a treasury afterwards. A stolen server key is stolen funds.

In v4 the server key only sends transactions. The contract pays the payee
directly, and the payee can be a cold wallet or a multisig.

## Scope

- `contracts/src/AstroAmEscrow.sol`
- `contracts/test/AstroAmEscrow.t.sol`
- `src/shared/monad/abi.ts` and a way to regenerate it
- `src/shared/monad/voucher.ts` gets a test

Nothing under `src/rails/`, `src/product/`, `scripts/` or `frontend/` (specs
05 and 08).

## Requirements

1. Constructor becomes `(usdc_, payee_, operator_, timeoutSeconds_)`.
   `operator_` must not be the zero address.
2. `payee` stays immutable and is where every `claim` and `close` payment
   goes.
3. `operator` is a public storage variable. `setOperator(address)` is callable
   only by the payee, rejects the zero address and emits
   `OperatorChanged(address indexed previous, address indexed current)`.
4. `claim` and `close` accept `msg.sender == operator` or
   `msg.sender == payee`. Anyone else reverts with `NotOperator()`. Remove
   `NotPayee` if nothing else uses it.
5. Vouchers do not change: same EIP-712 domain name and version, same
   `Voucher(bytes32 escrowId,uint256 cumulativeAmount)`, signed by the
   escrow's session key or its traveler. `deposit`, `topUp` and `refund` do
   not change.
6. Update the contract's NatSpec header so it describes the operator and
   states the bound on a compromised operator: it can close a channel early
   with what was already claimed, refunding the traveler; it cannot move funds
   anywhere except to the payee and the traveler.

## Tests (Foundry)

Keep every existing scenario passing with operator and payee as two different
accounts, and add:

- `claim` by the operator pays the payee, not the operator.
- `close` by the operator pays the payee and refunds the traveler.
- `claim` and `close` by the payee still work.
- `claim` and `close` by a third account, and by the traveler, revert with
  `NotOperator`.
- `setOperator`: only the payee; rejects zero; emits the event; the previous
  operator can no longer `claim`; the new one can.
- `refund` after `close` reverts with `AlreadySettled` (the Rust suite in
  astroam-solana covers this; the Foundry suite does not).
- A constructor test for the zero operator.

## ABI

`src/shared/monad/abi.ts` says it is generated but there is no generator. Add
a small script (`scripts/generate-abi.ts`, `npm run contracts:abi`) that runs
after `forge build` and rewrites the file from `contracts/out`. Add a test
that fails when the committed ABI differs from the build output, and is
skipped when `contracts/out` is absent, so it does not require Foundry.

Add `src/shared/monad/voucher.test.ts`: the typed-data hash produced by the
TypeScript helper equals the digest the contract computes in `voucherHash`
for a fixed escrow id, amount, chain id and contract address. Compute the
expected value once with Foundry and pin it in the test.

## Done when

- `forge test --root contracts` passes.
- `npm run check` passes. `npm test` may fail only in tests that exercise the
  rail against the contract (`src/rails/MonadRail.anvil.test.ts`); list any
  such failure in the report, since spec 05 fixes them.
