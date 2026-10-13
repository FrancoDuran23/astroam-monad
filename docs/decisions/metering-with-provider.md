# Decision: meter with the provider, no gateway of our own

**Date:** 24 September 2026 · **Status:** implemented (migration to Citrus Mobile, PR #9)

**Context.** The original design (see [`docs/citrus-mobile-brief.md`](../citrus-mobile-brief.md)
and [`docs/citrus-mobile-spec.md`](../citrus-mobile-spec.md)), which the
migration to Citrus replaced, measured bytes at a gateway of our own using
WireGuard: all of the traveler's traffic went through a server of ours, like a
VPN. That gateway was never built (`src/meter/demo-meter.ts` simulates it) and
it would cost servers in several regions, extra latency, a VPN that the
traveler has to turn on, and having all of their traffic pass through us.

**Decision.** We are a lightweight reseller: we manage the eSIM through an
API, but the provider does the metering and the cutoff. We keep what is
ours: the on-chain payment channel, the vouchers and the refund.

**Consequences.**

- The meter reads usage from the provider instead of from a gateway. This
  replaces the rule "we bill only on the gateway's bytes" of the original
  design.
- Citrus reports usage in **USD charged** (`total_data_charged_usd`), not in
  bytes. Bytes are computed as USD charged ÷ the country's rate. The
  accuracy has to be confirmed with a real account.
- There is a lag of ~10 minutes between usage and voucher. The risk is
  bounded by the eSIM's prepaid wallet: never more is used than was loaded.
- We trust the provider's numbers. Reconciliation
  (`src/jobs/reconciliation.ts`) stops comparing against the gateway.
- Citrus's API allows 100 requests per minute. With one reading every 10
  minutes that is enough for ~1,000 active eSIMs; beyond that, we have to use
  webhooks (`esim.balance_low`, `esim.balance_depleted`) or groups.
- Citrus has no sandbox: tests are done with real money (minimum top-up
  USD 4).

**Options discarded.**

- **Full reseller with a gateway of our own:** the most expensive to build and
  operate, and it worsens the traveler's experience.
- **Payment system only** (someone else sells the eSIM and integrates our
  channel): the simplest to operate, but it depends on finding partners. It
  remains a future B2B path, for example with wallets that offer the eSIM
  inside their app.
