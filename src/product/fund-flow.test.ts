import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FUND_FLOW,
  costCentsPaidBy,
  nextFundCents,
  claimIsDue,
  autoCloseReason,
  fundFlowConfigFromEnv,
} from "./services/fund-flow.ts";
import type { ProductMission } from "./types/mission.ts";

test("costCentsPaidBy: computes provider cost in USD cents based on markup and rate", () => {
  // 10 USDC (10_000_000 atomic) at a 1.5x markup (15_000 bps) pays for $6.66 (666 cents) of provider cost
  assert.equal(costCentsPaidBy(10_000_000n, DEFAULT_FUND_FLOW), 666);
  // 5 USDC pays for $3.33 (333 cents)
  assert.equal(costCentsPaidBy(5_000_000n, DEFAULT_FUND_FLOW), 333);
  // 0 USDC pays for 0 cents
  assert.equal(costCentsPaidBy(0n, DEFAULT_FUND_FLOW), 0);
  // Negative amount throws RangeError
  assert.throws(() => costCentsPaidBy(-1n, DEFAULT_FUND_FLOW), RangeError);
});

test("nextFundCents: one tranche past the voucher, never past what the deposit pays for", () => {
  // 10 USDC pays for 666 cents maximum.
  const fund = (voucherAtomic: bigint, fundedCents: number) =>
    nextFundCents({ depositAtomic: 10_000_000n, voucherAtomic, fundedCents }, DEFAULT_FUND_FLOW);

  // Initial funding with no vouchers: funds exactly one tranche (250 cents)
  assert.equal(fund(0n, 0), 250);
  // Already funded first tranche, no new vouchers: 0
  assert.equal(fund(0n, 250), 0);
  // 3 USDC voucher (pays for 200 cents). Target is 200 + 250 = 450 cents. Already funded 250 cents -> gap is 200 cents.
  assert.equal(fund(3_000_000n, 250), 200);
  // A gap under minFundCents (50 cents) is not worth a provider call
  assert.equal(fund(300_000n, 250), 0);
  // At 10 USDC voucher (cap 666 cents), funded 450 cents -> gap is 666 - 450 = 216 cents
  assert.equal(fund(10_000_000n, 450), 216);
  // Already at cap 666 cents -> 0
  assert.equal(fund(10_000_000n, 666), 0);
});

test("claimIsDue: triggers when uncollected voucher amount exceeds threshold", () => {
  const config = DEFAULT_FUND_FLOW; // claimMinAtomic = 2_000_000n (2 USDC)
  assert.equal(claimIsDue(1_000_000n, 0n, config), false);
  assert.equal(claimIsDue(2_000_000n, 0n, config), true);
  assert.equal(claimIsDue(3_500_000n, 2_000_000n, config), false); // gap is 1.5 USDC < 2 USDC
  assert.equal(claimIsDue(4_500_000n, 2_000_000n, config), true); // gap is 2.5 USDC >= 2 USDC
  assert.equal(claimIsDue(2_000_000n, 2_000_000n, config), false);
});

test("autoCloseReason: evaluates closing triggers", () => {
  const config = DEFAULT_FUND_FLOW;
  const now = new Date("2026-10-10T12:00:00Z");
  const timeoutSeconds = 30 * 24 * 3600; // 30 days

  const baseMission: ProductMission = {
    id: "m_1",
    userId: "u_1",
    destination: { id: "br", name: "Brasil", flag: "BR", network: "Vivo", coverage: "4G", pricePerMbUsdc: 0.0025 },
    startDate: "2026-10-01",
    endDate: "2026-10-08",
    durationDays: 7,
    budgetUsdc: 10,
    dailyLimitUsdc: 10,
    autoPause: true,
    lowBalanceAlert: true,
    status: "active",
    paymentStatus: "paid",
    esimStatus: "active",
    depositAtomic: "10000000",
    escrowActiveAt: "2026-10-01T12:00:00Z",
    meteredBytes: "0",
    carrierBytes: "0",
    balanceUsdc: 10,
    consumedUsdc: 0,
    consumedMb: 0,
    topups: [],
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
  };

  // 1. deposit_spent
  const spentMission: ProductMission = {
    ...baseMission,
    voucher: { cumulativeAtomic: "10000000", signature: "0x...", signedAt: "2026-10-05T00:00:00Z" },
  };
  assert.equal(autoCloseReason(spentMission, config, now, timeoutSeconds), "deposit_spent");

  // 2. trip_ended: endDate + grace period (24h + 24h grace)
  const endedMission: ProductMission = {
    ...baseMission,
    endDate: "2026-10-07", // ended 3 days ago relative to now (Oct 10)
  };
  assert.equal(autoCloseReason(endedMission, config, now, timeoutSeconds), "trip_ended");

  // 3. timeout_near: activeAt + timeout - margin
  const timeoutNearMission: ProductMission = {
    ...baseMission,
    endDate: "2026-10-25", // trip still in progress
    escrowActiveAt: "2026-09-10T12:00:00Z", // 30 days ago
  };
  assert.equal(autoCloseReason(timeoutNearMission, config, now, timeoutSeconds), "timeout_near");

  // 4. idle close
  const idleConfig = { ...config, idleCloseSeconds: 3600 }; // 1h
  const idleMission: ProductMission = {
    ...baseMission,
    endDate: "2026-10-25",
    lastUsageAt: "2026-10-10T10:00:00Z", // 2 hours ago
  };
  assert.equal(autoCloseReason(idleMission, idleConfig, now, timeoutSeconds), "idle");

  // 5. No trigger: returns null
  const healthyMission: ProductMission = {
    ...baseMission,
    endDate: "2026-10-15",
  };
  assert.equal(autoCloseReason(healthyMission, config, now, timeoutSeconds), null);
});

test("fundFlowConfigFromEnv parses environment variables properly", () => {
  const custom = fundFlowConfigFromEnv({
    FUNDING_TRANCHE_CENTS: "300",
    FUNDING_MIN_CENTS: "100",
    CLAIM_MIN_USDC: "3.5",
    ESCROW_CLOSE_MARGIN_SECONDS: "43200",
    ESCROW_IDLE_CLOSE_SECONDS: "1800",
    ESCROW_TRIP_END_GRACE_SECONDS: "7200",
  });
  assert.equal(custom.trancheCents, 300);
  assert.equal(custom.minFundCents, 100);
  assert.equal(custom.claimMinAtomic, 3_500_000n);
  assert.equal(custom.closeMarginSeconds, 43200);
  assert.equal(custom.idleCloseSeconds, 1800);
  assert.equal(custom.tripEndGraceSeconds, 7200);

  // Defaults when env is empty
  const defaults = fundFlowConfigFromEnv({});
  assert.deepEqual(defaults, DEFAULT_FUND_FLOW);
});
