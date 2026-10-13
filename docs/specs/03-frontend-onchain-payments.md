# 03 — Frontend: payments only on chain

## Why

Today the app treats a payment as "simulated" whenever the backend reports
the payment rail is not live, not only in demo mode. In that state it lets
the traveler continue with no transaction. It also offers a field to paste a
transaction hash by hand and invents one when the field is empty
(`MissionSetupPage.tsx`, `TopUpModal.tsx`).

Outside explicit demo mode, a payment must be a transaction sent from the
wallet.

Load the `astroam-design` skill (`.claude/skills/astroam-design/SKILL.md`)
before touching any screen.

## Scope

Everything under `frontend/`. No backend changes.

## Requirements

1. **Simulation only in demo mode.** `simulated` is `isDemoMode` and nothing
   else, in `MissionSetupPage.tsx`, `TopUpModal.tsx` and
   `ActiveMissionPage.tsx`. `caps.paymentsLive === false` outside demo mode is
   a configuration problem: show a blocking notice in the deposit step and in
   the top-up modal that says payments are not available, and disable the
   action. Do not let the flow continue.
2. **No manual transaction hash.** Remove the `txHashInput` field and the
   generated `0x${Date.now()…}` fallback from both screens. Outside demo mode
   the only way to confirm a deposit or a top-up is the wallet flow
   (`WalletDeposit`). If the payment intent has no `evm` block outside demo
   mode, show the same blocking notice.
3. **Demo traffic button.** "USE 5 MB" on `ActiveMissionPage.tsx` is shown
   only when `isDemoMode || caps?.demoTrafficEnabled !== false`. The field
   already exists in `types/mission.ts`.
4. **No invented carrier details.** `EsimSetupPage.tsx` and
   `DemoMissionService.ts` fabricate an LPA string and install URL on
   `rsp.citrusmobile.com` / `citrusmobile.com`. In demo data use the reserved
   domain `sample.invalid` and label the QR "SAMPLE — NOT A LIVE LINE", as
   astroam-solana does. Real values coming from the API are shown unchanged.
5. **Terms page.** Add `/terms` (`pages/TermsPage.tsx`), routed in `App.tsx`
   before the catch-all, linked from `Footer.tsx` and `MobileAppShell.tsx`.
   Port the text from astroam-solana's `TermsPage.tsx`, replacing what is
   specific to Solana with the Monad equivalents: Monad testnet, the
   AstroAmEscrow contract, USDC, the 30-day refund timeout, vouchers signed by
   a session key in the browser. Keep it marked as a draft.
6. `MissionOrbitCard.tsx` still mentions Stellar; correct it.
7. `frontend/.env.example`: add the production block astroam-solana has
   (hosted `VITE_API_BASE_URL`, what must be set on the host).

## Tests

- Unit tests for the pure decisions: a helper that returns whether a payment
  is simulated, blocked or on chain from `isDemoMode`, `caps` and the intent;
  and the demo-traffic visibility rule. Put them next to
  `utils/sessionKey.test.ts`.

## Done when

- `npm run typecheck`, `npm test` and `npm run build` pass in `frontend/`.
- `grep -rn "txHashInput\|Date.now().toString(16)" frontend/src` returns
  nothing.
- `grep -rn "citrusmobile.com" frontend/src` returns nothing.
- The existing session-key warnings and the balance pre-checks in
  `WalletDeposit` still work; they are ahead of astroam-solana and must not
  regress.
