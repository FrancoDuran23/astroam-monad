# Citrus Mobile: brief to replace Telnyx

> **Note:** this document was written when AstroAm's base charged on
> Stellar. Today the payments part goes through each chain's payment rail
> (`src/rails/PaymentRail.ts`); everything about Citrus is still current.

Goal: replace the Telnyx connectivity infrastructure with Citrus Mobile in the eSIM + on-chain USDC micropayments app. Implement Citrus behind the `ConnectivityProvider` interface, without tying the Stellar logic to the provider.

## Sources

- Docs in Markdown: https://citrusmobile.com/developer/docs/markdown
- OpenAPI: https://citrusmobile.com/openapi-reseller.yaml
- Recipes with code: https://citrusmobile.com/developer/guides
- Official MCP server (streamable HTTP): `https://citrusmobile.com/api/mcp`
  - No key: rates, coverage, cost estimation and docs search.
  - With `Authorization: Bearer rsk_...`: provision, fund, list and inspect eSIMs.
  - Claude Code: `claude mcp add --transport http citrus https://citrusmobile.com/api/mcp --header "Authorization: Bearer rsk_YOUR_KEY"`
- Support: support@citrusmobile.com

## Model

- Prepaid connectivity. Each eSIM has a **wallet in USD**. Usage drains it at each operator's and country's per-MB/GB rate.
- When the wallet reaches $0, the network cuts the data by itself. The maximum spend of a SIM is what was funded to it.
- There are no plans or bundles. One eSIM works in all countries.
- Reusing the eSIM between trips avoids paying the $1.75 provisioning again.

## Costs

- Free API, no monthly fee.
- **$1.75 per provisioned eSIM.**
- Data at **10% below retail**. Volume discounts from $1k/month.
- Reseller account: minimum top-up of **$10** (dashboard, paid with Stripe).
- Example: Japan from $1.38/GB (KDDI). Rates per country and operator in `GET /rates`.

## API v2

- Base: `https://citrusmobile.com/api/v2/reseller`
- Auth: `Authorization: Bearer rsk_...` (68 characters).
- Rate limit: **100 req/min per key**. If exceeded, 429 with a `Retry-After` header.

| Action | Endpoint |
|---|---|
| Provision | `POST /esim/provision` (optional: `end_user_reference`, `label`, `group_id`) |
| Fund | `POST /esim/{iccid}/fund` with `{amount}` (USD, 0.01 to 10000) |
| Detail / list | `GET /esim/{iccid}`, `GET /esim/list?status=&limit=&offset=` |
| Pause / resume | `POST /esim/{iccid}/disable`, `POST /esim/{iccid}/enable` |
| Return unused balance | `POST /esim/{iccid}/defund` |
| Terminate | `POST /esim/{iccid}/terminate` |
| Limit speed | `POST /esim/{iccid}/throttle` with `{speed}` (`NO_LIMIT`, `SPEED_100_KBPS` … `SPEED_5000_KBPS`) |
| Account | `GET /wallet/balance`, `GET /account`, `GET /rates?country=&continent=` |
| Webhooks | `GET/POST /webhooks`, `GET/PUT/DELETE /webhooks/{id}`, `POST /webhooks/{id}/test` |
| Groups (shared balance) | `/groups` and subroutes |

### `POST /esim/provision`

- Returns: `id`, `iccid`, `lpa_string`, `qr_code` (base64 PNG as a data URL), `direct_install_url` (iOS 17.4+, one tap), `status`, `euicc_state`, `group_id`, `cost`, `balance_remaining`, `created_at`.
- The SIM is born with a **wallet at $0**. Without `fund` it passes no data.
- Delivering the QR or the install link to the user is the app's responsibility.

### `GET /esim/{iccid}`

- `wallet_balance_usd`: remaining balance of the wallet.
- `total_data_charged_usd`: accumulated usage in USD at the `/rates` rates.
- `status`: `pending | active | suspended | terminated`.
- `euicc_state`: `RELEASED | DOWNLOADED | INSTALLED | ENABLED`.

### Errors

`INVALID_API_KEY` (401), `INSUFFICIENT_BALANCE` (402), `ESIM_NOT_FOUND` (404), `ESIM_ALREADY_TERMINATED` (400), `VALIDATION_ERROR` (400), `NO_ESIMS_AVAILABLE` (503, retry), `ESIM_IN_GROUP`, `DEFUND_ALREADY_PENDING` (409), `NO_BALANCE_TO_RETURN` (400), `WALLET_NOT_READY` (400), `RATE_LIMITED` (429).

## Webhooks

- HTTPS URL. Maximum 5 per account. They deactivate themselves after 10 consecutive failures.
- The `signing_secret` (`whsec_...`) is returned **only once** when registering the webhook. Save it.
- Verification: HMAC-SHA256 of the **raw body** with the `signing_secret`, compared against the `X-Citrus-Signature` header.
- Envelope: `{ id, event, created_at, data }`.
- Subscription to specific events or to `["*"]`.
- They document no timestamp or replay protection. Deduplicate by the event's `id`.

| Event | When |
|---|---|
| `esim.provisioned` | The eSIM was provisioned |
| `esim.activated` | The user installed it and it started |
| `esim.balance_low` | The wallet crossed **$5** (fixed threshold, only once) |
| `esim.balance_depleted` | The wallet reached $0 and the network cut off |
| `esim.defunded` | The balance was returned (`returned_usd`) |
| `esim.data_suspended`, `esim.data_resumed`, `esim.terminated` | State changes |
| `balance.low`, `balance.depleted`, `balance.topped_up`, `balance.auto_refill_succeeded`, `balance.auto_refill_failed` | Reseller account balance |
| `group.*`, `esim.group_assigned`, `esim.group_removed` | Shared balance groups |

## Details that break integrations

1. **Reporting delay of ~10 to 15 min.** `fund` responds instantly and the user can already use data. But `total_data_charged_usd` and the balance events pause for ~15 min after each fund. The usage is still counted and appears in the next cycle.
2. **`wallet_balance_usd` is rounded down**, up to ~5¢ below the real balance. Funding $20 shows $19.99. Amounts like $9, $18 and $27 come out exact.
3. **There is no usage endpoint in bytes.** Usage arrives only in USD. Converting to bytes requires dividing by the operator's rate from `/rates` and is approximate. This affects the reconciliation between our own gateway's bytes and the carrier's usage.
4. **`defund` is asynchronous.** It returns 202, pauses the data and credits in ~15 min to the **reseller account**, not to the end user. During that time the SIM cannot be funded or reactivated. The final amount may be less than `estimated_return_usd` if there was usage. The refund to the user is resolved in the on-chain payment channel.
5. **`terminate` is irreversible and loses the remaining balance.** Do `defund` first.
6. **Groups are not useful for billing per user.** A SIM in a group has no wallet of its own (`wallet_balance_usd` and `total_data_charged_usd` come back `null`). Use one standalone eSIM per user.
7. **`esim.balance_low` is fixed at $5** and not configurable. With the delay of 10 to 15 min, the top-up policy needs a cushion.

## Mapping to `ConnectivityProvider`

| Interface method | Citrus |
|---|---|
| `provisionEsim` | `POST /esim/provision` |
| `topUp` | `POST /esim/{iccid}/fund` |
| `getUsage` / `getBalance` | `GET /esim/{iccid}` (`total_data_charged_usd`, `wallet_balance_usd`) |
| `suspend` / `resume` | `disable` / `enable` |
| `refundUnused` | `defund` |
| `terminate` | `terminate` |
| Cutoff by balance | `esim.balance_depleted` event |

Flow: the gateway measures bytes, billing converts them to price, the voucher is signed on the payment channel and the operator funds the SIM in tranches ahead of time. The float is covered by the reseller account balance.

## Unverified

- The partner page promises a sandbox, but the OpenAPI only lists the production server. Each provisioning there costs a real $1.75. Confirm in the dashboard how to access the sandbox before running tests.
- Citrus's pages say "200+" and "220" destinations inconsistently.
- The price was not compared against Telnyx.
- There is no SLA or coverage detail per country outside `/rates`. New provider: check `/rates` for the countries needed.
