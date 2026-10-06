# Formal Support & Feature Inquiry: Citrus Mobile Reseller API

**To:** `support@citrusmobile.com`  
**From:** AstroAm Engineering & Operations Team (`ops@astroam.io` / `dev@astroam.io`)  
**Date:** October 2026  
**Subject:** Technical Inquiry: Programmatic Wallet Top-ups, Auto-refill Trigger Behavior, and USDC Settlement for AstroAm Integration  
**Reseller Account:** AstroAm Reseller Account (`[YOUR_CITRUS_ACCOUNT_EMAIL_OR_ID]`)

---

## Cover Letter / Message Body

Dear Citrus Mobile Support & Product Team,

We are the engineering team at **AstroAm** (https://astroam.io), building a non-custodial global connectivity protocol that provides travelers with seamless prepaid cellular data powered by real-time blockchain micropayments (deployed on Monad and Solana).

We have integrated our backend directly with the **Citrus Mobile Reseller API v2** (`https://citrusmobile.com/api/v2/reseller`) to handle automated eSIM provisioning, real-time lifecycle management, and usage monitoring.

As we scale our production operations and transition to fully automated, unattended infrastructure, we would appreciate clarification on three specific topics regarding reseller balance management, auto-refill mechanics, and settlement options:

1. **Programmatic Wallet Top-up via API**
2. **Auto-Refill Threshold Trigger Conditions for Sub-Wallet Allocations (`/fund`)**
3. **Crypto / USDC Settlement for Reseller Account Funding**

Below, we provide the architectural context of our integration, followed by our specific questions.

---

### Architectural Context: How AstroAm Uses Citrus Mobile

In AstroAm’s architecture:
1. **Per-Traveler Standalone eSIMs:** We provision individual prepaid eSIMs for travelers via `POST /esim/provision` (\$1.75 fee).
2. **Dynamic Tranche Funding:** Instead of funding large lump sums up-front, our backend dynamically funds the traveler's eSIM wallet in incremental tranches (typically \$2.50 USD per tranche via `POST /esim/{iccid}/fund`) as the traveler consumes cellular data and signs streaming payment vouchers on-chain.
3. **Automatic Defunding:** When the journey completes, any remaining unused wallet balance on the eSIM is recovered back to our master reseller account via `POST /esim/{iccid}/defund`.

This approach ensures zero credit risk, shields travelers from overpaying, and keeps data active continuously. However, it relies heavily on high-frequency programmatic interactions with the master reseller wallet balance.

---

### 1. Programmatic Wallet Top-up via API

#### Current Behavior
Currently, adding funds to the master reseller balance requires manual intervention by an operator logging into the Citrus web dashboard and initiating a Stripe card payment. While the `GET /wallet/balance` endpoint provides accurate read access to current funds, we could not identify a public API endpoint to programmatically trigger a balance top-up.

#### Inquiries
1. **Existing or Undocumented Endpoints:** Is there an existing API endpoint (e.g., `POST /wallet/topup` or `POST /wallet/refill`) that allows an authenticated reseller API client to charge a stored payment method (such as the default credit card configured in the dashboard) for a specified USD amount?
2. **Roadmap Plans:** If no such endpoint exists, is programmatic balance replenishment on your product roadmap? If so, what is the anticipated timeline or beta availability?
3. **Dedicated Billing Webhooks:** In case programmatic top-ups become available, what webhooks or callbacks are recommended to reconcile top-up transactions beyond the standard `balance.topped_up` event?

---

### 2. Auto-Refill Trigger Conditions & Sub-Wallet Allocations

#### Current Behavior
We observed that Citrus offers an automated refill feature in the dashboard (*Auto-Refill*), which charges a saved card when the master account balance drops below a user-defined threshold.

However, during our tests, auto-refill appears to be triggered solely when the balance drops due to an **accounting expenditure** (such as provisioning an eSIM for \$1.75 via `POST /esim/provision`), but **not** when the balance is drawn down via **internal sub-wallet allocations** (such as `POST /esim/{iccid}/fund`).

Because AstroAm's primary operational volume consists of continuous \$2.50 tranches transferred from the master wallet into traveler eSIM wallets, our master balance can drop below the low-balance threshold without triggering the auto-refill mechanism. Consequently, subsequent `POST /esim/{iccid}/fund` calls risk failing with `402 INSUFFICIENT_BALANCE` unless an eSIM provisioning happens to trigger the charge.

#### Inquiries
1. **Trigger Definition:** Can the auto-refill engine be configured (or updated on your backend) to evaluate total available master balance regardless of the operation type that caused the drawdown (i.e., triggering whenever `balance_usd < threshold`, including after `POST /esim/{iccid}/fund` calls)?
2. **Recommended Best Practice:** What is Citrus's recommended operational pattern for automated resellers using standalone sub-wallets who need uninterrupted balance replenishment without manual dashboard monitoring?
3. **Webhook Failure Recovery:** In the event of a `balance.auto_refill_failed` webhook, does Citrus implement automatic retry intervals (e.g., exponential backoff over 24 hours), or is the auto-refill feature permanently disabled until manually re-enabled in the dashboard?

---

### 3. Direct USDC / Cryptocurrency Settlement

#### Context
AstroAm operates entirely on stablecoins: travelers deposit and settle their connectivity fees in **USDC** (USD Coin) on-chain.

Currently, funding our Citrus reseller account requires off-ramping on-chain USDC to traditional banking rails and charging a fiat corporate credit card via Stripe. This introduces:
- Unnecessary foreign exchange (FX) and card processing fees (~2.9% + interchange/cross-border fees).
- Banking settlement delays (1–3 business days).
- Card limit constraints and potential bank fraud false positives during high volume periods.

#### Inquiries
1. **Direct Crypto / Stablecoin Invoicing:** Does Citrus Mobile support or plan to support direct USDC / crypto deposits for reseller wallet funding (e.g., native USDC on Solana, Ethereum, Base, or Polygon)?
2. **Crypto Payment Gateways:** Alternatively, does Citrus support enterprise billing integrations through crypto-native merchant processors (e.g., Stripe Crypto Pay-ins, Sphere, BVNK, or BitPay)?
3. **Pre-funded Enterprise Accounts / Invoicing:** For higher monthly volume commitments, do you offer post-paid monthly invoicing or high-limit wire/ACH pre-funding with custom terms to mitigate card processing limits?

---

## Contact Information & Follow-Up

We are eager to work closely with your technical team to ensure a rock-solid, production-grade integration. If a brief technical sync or call is preferable, we are glad to schedule one at your convenience.

Thank you very much for your time and continued support.

Warm regards,

**The AstroAm Engineering Team**  
- **Email:** `support@astroam.io` / `dev@astroam.io`  
- **Website:** [https://astroam.io](https://astroam.io)  
- **Citrus Reseller Account ID:** `[INSERT_RESELLER_ACCOUNT_ID_OR_EMAIL]`  
- **GitHub / Architecture Reference:** [AstroAm Monad](https://github.com/FrancoDuran23/astroam-monad) / [AstroAm Solana](https://github.com/FrancoDuran23/astroam-solana)  
