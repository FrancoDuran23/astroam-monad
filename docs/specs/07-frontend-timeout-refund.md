# 07 — Frontend: refund after the timeout

Runs after spec 03 (both change `ActiveMissionPage.tsx`).

## Why

The contract protects the traveler if AstroAm disappears: `timeoutSeconds`
after the last deposit, top-up or claim, anyone can call `refund(escrowId)`
and everything not yet claimed returns to the traveler. The app has no way to
do it. Today the traveler would have to call the contract by hand from a
block explorer.

Load the `astroam-design` skill before touching the screen.

## Scope

- `frontend/src/chain/monad.ts`
- `frontend/src/hooks/useMission.ts`
- `frontend/src/pages/ActiveMissionPage.tsx` and, if a component is cleaner,
  one new file under `frontend/src/components/dashboard/`
- Tests under `frontend/src/utils/` or next to the new code

No backend change: everything needed is read from the contract.

## Requirements

1. `chain/monad.ts` gains:
   - a read of the escrow (`escrows(escrowId)`) and of `timeoutSeconds()`,
     returning when the refund becomes available
     (`lastActivityAt + timeoutSeconds`), how much it would return
     (`deposit - claimed`) and whether the escrow is already settled;
   - `refundEscrow(escrowId)`, which simulates then sends `refund` from the
     connected wallet and waits for the receipt.
2. On the trip screen, for a mission paid on chain whose escrow is not
   settled:
   - before the timeout, a quiet line: "If AstroAm never closes this trip you
     can withdraw the unspent balance yourself from <date>." No button.
   - after the timeout, a clear action "WITHDRAW UNSPENT BALANCE" showing the
     amount, which calls `refundEscrow`.
3. After a successful refund show the transaction link on the explorer and
   the wallet's USDC balance, reusing the existing "refund landed" display,
   and tell the backend the trip is over through the existing cancel or
   finish call. If the backend is unreachable, the refund still counts as
   done: say so and do not show an error for the traveler's own money
   arriving.
4. Errors are specific: wrong network (offer the switch), rejected in the
   wallet, no MON for gas, timeout not reached yet (re-read the chain and
   show the date), already settled (show that the trip was closed and what
   was refunded).
5. Not shown in demo mode, where there is no escrow.
6. `refund` is callable by anyone, and the funds always go to the escrow's
   traveler. If the connected wallet is not the traveler, say that the
   balance will go to the traveler's address and show that address.

## Tests

- The pure function that turns the escrow fields and the current time into
  one of: not available yet (with the date), available (with the amount),
  nothing to withdraw, already settled.
- Boundary: exactly at `lastActivityAt + timeoutSeconds` the contract allows
  the refund (it reverts only while `block.timestamp` is below), so the
  function reports available.

## Done when

`npm run typecheck`, `npm test` and `npm run build` pass in `frontend/`.
