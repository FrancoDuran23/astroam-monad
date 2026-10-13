# Testing Guide: Reseller Balance Auto-Refill on Citrus Mobile

**Operational Document (C4)**  
**Project:** AstroAm (Monad / Solana)  
**Audience:** Operations, Backend and Infrastructure Team  
**Last updated:** October 2026  

---

## 1. Context and Rationale for the Experiment

In AstroAm's connectivity architecture, the provider **Citrus Mobile** operates with a centralized prepaid balance model for resellers (*Master Reseller Wallet*) and individual prepaid wallets for each eSIM (*eSIM Sub-Wallets*).

### The problem detected
1. **Fundings as internal transfers:** When AstroAm executes `POST /esim/{iccid}/fund` to load balance onto an eSIM in usage tranches (e.g. \$2.50 USD), Citrus deducts the amount from the reseller balance and assigns it to the eSIM's wallet. In accounting terms, Citrus treats this movement as an **internal transfer**, not as a settlement or final expense.
2. **Auto-refill trigger:** The auto-refill rule configured in the Citrus dashboard (automatic charge to a card via Stripe) is designed to activate when the master balance falls below a predefined threshold because of a **real billed expense** (for example, the provisioning of a new eSIM at \$1.75 USD).
3. **Operational risk:** If successive tranche fundings drain the reseller balance below the auto-refill threshold without an eSIM provisioning taking place, the reseller account may reach \$0 USD (or an insufficient balance) without having triggered the Stripe charge. This would cause the following calls to `POST /esim/{iccid}/fund` to fail with error `402 INSUFFICIENT_BALANCE` and stop the travelers' connectivity.

### Goal of the test
Validate empirically with **real money and a credit card**:
1. Whether Citrus indeed ignores transfers to eSIMs for the purpose of triggering the automatic Stripe charge when the balance falls below the threshold.
2. Whether a later real expense (eSIM provisioning for \$1.75 USD) executed while the balance is already below the threshold **successfully triggers** the auto-refill.
3. The behavior and latency of the associated webhooks (`balance.auto_refill_succeeded` or `balance.auto_refill_failed`).

---

## 2. Prerequisites

Before starting the procedure, verify that the following conditions are met:

- [ ] **Access to the Citrus Reseller Dashboard:** Active credentials at [https://citrusmobile.com](https://citrusmobile.com).
- [ ] **Registered payment method:** A valid corporate credit or debit card with sufficient funds, loaded in Stripe through the Citrus dashboard.
- [ ] **Reseller API Key:** Bearer key (`rsk_...`) with query, provisioning and funding permissions.
- [ ] **Operational webhook receiver:** AstroAm public endpoint active (or a local tunnel with Ngrok/Localtunnel pointing to `POST /citrus/webhooks`) with `CITRUS_WEBHOOK_SECRET` configured and verified.
- [ ] **Existing test eSIM:** An eSIM already provisioned in the account to carry out the test fundings (or the ability to provision a first eSIM for the cycle).
- [ ] **Initial available balance:** Have a Citrus balance above the threshold to be tested (e.g. if the threshold will be set at \$20 USD, have ~\$25–\$30 USD of master balance).

---

## 3. Step-by-Step Procedure

```
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Configure Auto-Refill in the Dashboard                         │
│  - Threshold: $20 USD                                                  │
│  - Refill Amount: $100 USD (active Stripe card)                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Drain balance with POST /esim/{iccid}/fund                     │
│  - Fund the eSIM until the master balance drops below $20 USD         │
│  - Observe: there must be NO Stripe charge yet                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Execute a real expense POST /esim/provision                    │
│  - Real cost: $1.75 USD                                                │
│  - Master balance was already below the threshold                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Observe the Stripe charge and the credit                       │
│  - Stripe charges $100 USD                                             │
│  - Reseller balance rises to (Previous balance - $1.75 + $100)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 5: Verify Webhooks received                                       │
│  - balance.auto_refill_succeeded (or balance.auto_refill_failed)       │
│  - Record in the JSONL and structured backend logs                     │
└────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Configuration in the Citrus Dashboard

1. Log in to the Citrus Mobile reseller portal.
2. Navigate to **Settings** > **Billing & Payments** (or **Wallet / Auto-Refill**).
3. Enable **Auto-Refill**:
   - **Low Balance Trigger / Threshold:** Set to **\$20.00 USD** (or \$50.00 USD if the current balance is higher).
   - **Refill Amount:** Set to **\$100.00 USD** (recommended amount to dilute fixed bank fees and amortize operating costs).
   - **Payment Method:** Select the main credit card.
4. Make sure the Webhook URL is registered in the **Webhooks** section:
   - URL: `https://<your-domain-or-ngrok>/citrus/webhooks`
   - Events: Select `balance.*` and `esim.*` (or the wildcard `*`).
   - Copy and safeguard the `signing_secret` (`whsec_...`).

### Step 2: Drain the reseller account balance through tranches (`fund`)

The goal is to reduce the master account balance below the \$20.00 USD threshold through internal transfers to an eSIM's wallet.

1. Query the reseller account's current balance:
   ```bash
   curl -s -X GET "https://citrusmobile.com/api/v2/reseller/wallet/balance" \
     -H "Authorization: Bearer $CITRUS_API_KEY"
   ```
   *Expected response:*
   ```json
   {
     "balance_usd": 27.50,
     "currency": "USD"
   }
   ```

2. Fund the test eSIM with the tranches needed for the balance to fall below \$20.00 USD (for example, \$10.00 USD):
   ```bash
   curl -s -X POST "https://citrusmobile.com/api/v2/reseller/esim/89882.../fund" \
     -H "Authorization: Bearer $CITRUS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"amount": 10.00}'
   ```

3. Check the reseller balance again:
   ```bash
   curl -s -X GET "https://citrusmobile.com/api/v2/reseller/wallet/balance" \
     -H "Authorization: Bearer $CITRUS_API_KEY"
   ```
   *Expected response:*
   ```json
   {
     "balance_usd": 17.50,
     "currency": "USD"
   }
   ```

4. **Critical verification point:**
   - Enter the banking app / credit card portal or the Stripe dashboard.
   - **Confirm that NO charge has been made to the card.**
   - Check the AstroAm backend logs: **No `balance.auto_refill_succeeded` webhook should have arrived**.

> [!NOTE]
> This confirms the operational hypothesis: transfers to eSIM wallets are not counted as auto-refill trigger events by Citrus's billing engine.

### Step 3: Trigger the real expense by provisioning an eSIM (\$1.75 USD)

With the master balance at \$17.50 USD (below the configured threshold of \$20.00 USD), execute the provisioning of a real eSIM. This act represents an unrecoverable cost of \$1.75 USD debited directly as a service charge by Citrus.

1. Execute the API call:
   ```bash
   curl -s -X POST "https://citrusmobile.com/api/v2/reseller/esim/provision" \
     -H "Authorization: Bearer $CITRUS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "label": "Test-AutoRefill-C4",
       "end_user_reference": "astroam-refill-test"
     }'
   ```

2. Save the ICCID returned in the response for inventory control.

### Step 4: Observe the Auto-Refill and Stripe behavior

Immediately after the response of `POST /esim/provision`:

1. **Check the bank charge:**
   - Review the card alerts or the Stripe dashboard.
   - Was there a charge of \$100.00 USD from Citrus Mobile?
2. **Query the balance in the API again:**
   ```bash
   curl -s -X GET "https://citrusmobile.com/api/v2/reseller/wallet/balance" \
     -H "Authorization: Bearer $CITRUS_API_KEY"
   ```
   - If the refill worked: the balance should reflect:
     $$\text{Final balance} = 17.50 - 1.75 + 100.00 = 115.75\text{ USD}$$
   - If the refill was **not** activated: the balance will reflect only $15.75 USD.

### Step 5: Inspection of Webhooks and Backend Logs

Verify on the AstroAm server the reception of the Citrus webhooks.

#### Successful Case: `balance.auto_refill_succeeded`
Citrus sends a webhook with a payload similar to:
```json
{
  "id": "evt_refill_succ_123456",
  "event": "balance.auto_refill_succeeded",
  "created_at": "2026-10-06T15:00:00Z",
  "data": {
    "amount_usd": 100.00,
    "new_balance_usd": 115.75,
    "payment_method": "pm_card_visa_4242",
    "stripe_charge_id": "ch_3M..."
  }
}
```
- **Expected log in AstroAm:**
  ```json
  {"level":"info","reason":"citrus_balance_refilled","event":"balance.auto_refill_succeeded","amountUsd":100,"newBalanceUsd":115.75}
  ```

#### Failed Case: `balance.auto_refill_failed`
If the card rejects the payment (insufficient funds on the card, bank anti-fraud block):
```json
{
  "id": "evt_refill_fail_987654",
  "event": "balance.auto_refill_failed",
  "created_at": "2026-10-06T15:00:00Z",
  "data": {
    "amount_usd": 100.00,
    "current_balance_usd": 15.75,
    "failure_code": "card_declined",
    "failure_message": "Your card was declined."
  }
}
```
- **Expected alert in AstroAm:**
  ```json
  {"level":"error","reason":"citrus_auto_refill_failed","event":"balance.auto_refill_failed","message":"Auto-refill charge failed"}
  ```

> [!CAUTION]
> When a `balance.auto_refill_failed` occurs, **Citrus automatically disables auto-refill** to avoid continuous retries. A human operator must enter the dashboard to reactivate it manually once the problem with the card issuer is resolved.

---

## 4. Economic Breakdown of the Test

The real cost of the experiment is divided into incurred expense and increase in operating balance:

| Item | Amount | State of the Funds |
|---|---|---|
| eSIM provisioning (`POST /esim/provision`) | **\$1.75 USD** | **Real expense consumed** (cost of the test). The eSIM remains available for future tests. |
| eSIM funding (`POST /esim/{iccid}/fund`) | \$10.00 USD | **Recoverable**. `POST /esim/{iccid}/defund` can be executed to return this balance to the master account (takes ~15 min). |
| Auto-refill via Stripe | \$100.00 USD | **Value retained**. It stays as a credit in the Citrus account to operate missions and consume data. |
| **Final net cost of the test** | **\$1.75 USD** | Only the \$1.75 of the eSIM is unrecoverable cost. |

---

## 5. Test Results Recording Template

Fill in this sheet once the test has been run with the real card:

```markdown
### C4 Test Execution Record

- **Date and Time (UTC):** YYYY-MM-DD HH:MM:SS
- **Responsible operator:** [Name / Role]
- **Citrus Account ID:** [Account ID / Email]
- **Last 4 digits of the card:** [**** 1234]

#### Configured Parameters
- Initial balance in account: $____.__ USD
- Auto-refill threshold (Threshold): $____.__ USD
- Refill amount (Refill Amount): $____.__ USD

#### Sequence Results
1. Balance after internal fundings (without provisioning): $____.__ USD
   - Was the card charged at this point?: [ YES / NO ]
2. ICCID of the provisioned eSIM: 89882...
   - Balance immediately after provisioning: $____.__ USD
3. Stripe charge:
   - Was the auto-refill charge triggered?: [ YES / NO ]
   - Stripe charge ID / Transaction: ch_...
4. Webhooks received in AstroAm:
   - Event received: [ balance.auto_refill_succeeded / balance.auto_refill_failed / None ]
   - Event ID: evt_...
   - Approximate latency since provisioning: ____ seconds
5. Final state of the Citrus account:
   - Final available balance: $____.__ USD
   - Auto-refill state in dashboard: [ ACTIVE / DISABLED ]

#### Operational Conclusions and Observations
- [Detail anomalies, unusual delays or 3D Secure bank requirements if there were any]
```

---

## 6. Operational Recommendations for Production

1. **Keep a high preventive threshold in AstroAm:**  
   Because Citrus may be slow to react or depend on real expenses, configure in `.env`:
   ```env
   CITRUS_RESELLER_LOW_BALANCE_USD=50
   ```
   This ensures the backend emits warnings and stops admitting missions before the account is left without funds.
2. **Monitoring of `balance.auto_refill_failed`:**  
   Configure a critical-severity alert (PagerDuty, Telegram or Slack Ops) for any `balance.auto_refill_failed` event.
3. **Reclaim idle funds:**  
   At the end of any session or test where eSIMs were funded, invoke `POST /esim/{iccid}/defund` to return the balance to the central account.
