# Plan: "the refund does not reach the wallet" — diagnosis and execution

Date: 2026-10-03 · Suggested branch: `fix/refund-visibility-and-orphan-missions`

## 1. Diagnosis (checked on the chain, not assumed)

**The refund DID execute.** The close tx of the last mission (`0x762f861a…2095e`, status `success`) contains two USDC transfers from the escrow `0xc6ead43f…7a0f`:

| Destination | Amount |
|---|---|
| Payee `0x441D…4b40` (AstroAm) | 3.125 USDC (what was used) |
| Traveler `0x4aB3…997F` (Igna) | **1.875 USDC (the remainder)** |

The app showed "Paid 3.13 / Back to your wallet 1.88": those are the same amounts rounded to 2 decimals.

Current balances on Monad Testnet (read from the RPC):

| Account | USDC |
|---|---|
| Traveler (Igna) | 3.675 |
| Payee (AstroPay) | 11.325 |
| Escrow | **5.000** |

The accounts add up with the 5 missions saved in `data/missions.json`: the traveler started with 20; deposited 4.5 + 5 + 5 + 5 + 5; recovered 2 + 2 + 2.3 + 1.875 → **3.675**. The payee collected 2.5 + 3 + 2.7 + 3.125 = **11.325**.

### Why in MetaMask "nothing moved"
1. **The screenshots show MON, not USDC.** The refund is in USDC. MON is only gas: the traveler paid ~0.14 MON across the `approve` and `deposit` transactions, and the payee spent ~0.014 MON on the `close`. The traveler's MON could not go up.
2. **MetaMask's Activity tab does not list the refund.** That tab shows the transactions the account *sends*. The refund is sent by the contract, and MetaMask does not always index it as an entry. It is only visible in the **Tokens → USDC** tab and in the explorer.
3. **The app does not show the traveler the proof.** The "Mission settled" modal shows the link to the close tx, but not the resulting USDC balance or which transfer to look for. That is the real product gap.

### Real problem found (it is not the refund)
**5 USDC were left locked in the escrow.** The mission `mis_1791050861186_j3s42x` (Spain) made the on-chain deposit and stayed in state `paid` with `esimStatus: not_provisioned`: the flow was cut off before activation and it was never closed. The contract does not lose that money (the traveler recovers it with `refund()` after 30 days), but today there is no way to cancel or close it from the app.

### Minor details
- Rounding: the UI shows 3.13 / 1.88; on-chain they are 3.125 / 1.875. It is better to show 3 decimals or a consistent rounding that adds up to the deposit.
- The test was done with `CONNECTIVITY_PROVIDER=fake` (simulated eSIM), which is right for validating the payment.

## 2. Execution plan

### Step 0 — Check it yourself in MetaMask (2 min, no code)
1. Account **Igna** → Monad Testnet network → **Tokens** tab → **USDC**. It should say **3.675**.
2. Open the close tx (`0x762f…095e`) in the explorer and go to "Token Transfers": you will see the 1.875 USDC going to `0x4aB3…997F`.
3. If the USDC does not appear in Tokens, import the token `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals).

### Step 1 — Recover the 5 locked USDC
- Write `scripts/close-escrow.ts` (pattern of `deploy-monad-escrow.ts`): it signs with the payee's key and calls `close(escrowId, 0, "0x", 0)`, which **refunds 100% without a voucher**.
- Escrow to close: `0xd6b09af4d48b808d94a139bbed1c167f188af84273d70e24e787…` (channel of the mission `j3s42x`; the full id is in `data/missions.json`).
- Before sending, the script reads `escrows(id)` and refuses if it is already settled. It prints the tx and the amount returned.
- **Requires your explicit confirmation** (it sends a real tx and spends the payee's MON).
- Verification: the traveler's USDC goes up from 3.675 to 8.675 and the escrow's goes down to 0.

### Step 2 — Cancellation of missions that were never activated (fixes the cause)
- Backend: in `src/product/` add a `cancel` action for missions with `paymentStatus: paid` and `esimStatus: not_provisioned`. It calls `closeChannel(channelId, 0n)` in `MonadRail` (it already supports `settleRaw = 0`) and marks the mission `cancelled`.
- Frontend: a "Cancel and refund" button on the dashboard for those missions, and detection when the app is reopened (a `paid` mission without an eSIM → offer to resume or cancel).
- Tests: successful cancellation, double cancellation, mission already active (must reject).

### Step 3 — Let the traveler see the refund (fixes the perception)
- In "Mission settled" show: the wallet's USDC balance before and after (a `balanceOf` read), a link to the tx and a line "Refund of X USDC sent to 0x4aB3…997F".
- Short text: "Look under Tokens → USDC; MetaMask's Activity tab may not list incoming refunds".
- Show 3 decimals in the close amounts so they match the chain.
- Improve the initial notice to remind the user to import USDC in MetaMask.

### Step 4 — End-to-end test and record
1. One new complete mission: deposit, use MB, close. Read the `Closed(paid, refunded)` event and check the balances in the app and in MetaMask (Tokens → USDC).
2. One mission cancelled before activation (step 2) and check the 100% refund.
3. `npm run check`, `npm test` and `forge test` green.
4. Update the README and `docs/monad-deployments.md` with the contract address and the result.

## 3. Order and estimated effort
| # | What | Effort | Who |
|---|---|---|---|
| 0 | Check in MetaMask | 2 min | you |
| 1 | Recover the 5 USDC | ~20 min | me (with your OK) |
| 2 | Cancel missions that were not activated | ~1–2 h | me |
| 3 | Show the refund in the UI | ~1 h | me |
| 4 | End-to-end test and docs | ~30 min | both |

## 4. Risks and open decisions
- **Who can cancel:** today only the payee can close, so cancellation goes through the backend. We have to decide whether it requires the access token in live mode.
- **Safe retry:** `closeChannel` must be idempotent: if the tx was sent but the response was lost, re-read `escrows(id).settled` before retrying.
- **Traveler funds in other missions:** the four closed missions already returned their remainder; only `j3s42x` has pending funds.

## 5. Execution status
- **Step 1 done.** Close of the orphan escrow: tx `0x2215e659ab853821226e731b069fafd55c9dcc4a10658d36750772998a1bf84e`, 5 USDC returned (traveler 3.675 → 8.675; escrow 0).
- **Step 2 done.** `POST /api/missions/:id/cancel` (`MissionProductService.cancelMission`): only `paid` missions without an eSIM or consumption, idempotent, and if the channel was already closed outside the app it only updates the record. New state `cancelled`. In the frontend, `MissionSetupPage` shows the "UNFINISHED TRIP" notice with **Activate eSIM** and **Cancel and refund**. Four new tests; the backend ends at 198 passing, 0 failing, 2 skipped. The mission `j3s42x` ended up `cancelled` without sending any tx.
- **Step 3 done.** "Mission settled" shows paid and refunded with 3 decimals, the wallet's USDC balance before and now (read from the chain) and the notice to look at Tokens → USDC. It only appears on missions deposited from this browser with this version (the wallet is saved at deposit time); on earlier ones the usual modal is shown.
- **Step 4 done (verified).** End-to-end test completed successfully on Monad Testnet with MetaMask on the `AstroAmEscrow` v3 contract (`0xe89893d51180e517e2bf175398aad2e6da82c0f9`): deposit of 5.00 USDC, EIP-712 vouchers signed silently by the session key in localStorage (250 MB consumed), channel close settling 0.625 USDC to the payee and automatic refund of 4.375 USDC to the traveler in a single on-chain transaction. Reconciliation and events validated. See the full detail in [monad-e2e-test-report.md](monad-e2e-test-report.md).
