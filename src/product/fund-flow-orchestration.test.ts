import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService } from "./services/MissionProductService.ts";
import { DEFAULT_FUND_FLOW, costCentsPaidBy, nextFundCents } from "./services/fund-flow.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import { runFundFlowOnce } from "../jobs/fund-flow.ts";

class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>();
  async save(mission: ProductMission): Promise<void> {
    this.store.set(mission.id, structuredClone(mission));
  }
  async findById(id: string): Promise<ProductMission | null> {
    const mission = this.store.get(id);
    return mission ? structuredClone(mission) : null;
  }
  async findByPaymentIntentId(): Promise<ProductMission | null> {
    return null;
  }
  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.store.values(), (mission) => structuredClone(mission));
  }
}

const BRASIL = { id: "br", name: "Brasil", flag: "BR", network: "Vivo", coverage: "4G/5G", pricePerMbUsdc: 0.0025 };
const TREASURY = "0x6666666666666666666666666666666666666666";
const MB = 1_000_000;

function mockVoucher(atomic: bigint) {
  return {
    cumulativeAtomic: atomic.toString(),
    signature: `0x${"ab".repeat(65)}`,
  };
}

let service: MissionProductService;
let provider: FakeProvider;
let rail: FakeRail;
let clock: Date;

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = "true";
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.PRICE_PER_MB_RAW;
});

after(() => {
  delete process.env.ENABLE_DEMO_TRAFFIC;
});

beforeEach(() => {
  clock = new Date("2026-10-05T12:00:00Z");
  provider = new FakeProvider();
  rail = new FakeRail({ now: () => clock });
  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: provider,
    rail,
    timeoutSeconds: 7 * 24 * 3600, // 7 days
    logger: () => {},
  });
});

/** A paid and activated trip whose deposit and session key are recorded. */
async function openTrip(budgetUsdc = 10, endDate = "2026-10-12") {
  const created = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate,
    budgetUsdc,
    dailyLimitUsdc: budgetUsdc,
  });
  const intent = await service.createPaymentIntent(created.id);
  await service.confirmPayment(created.id, intent.intentId, "0xdeposit_tx_hash_123");
  const activated = await service.activateMission(created.id);
  const mission = await service.getMission(created.id);
  return { id: created.id, escrowId: mission.escrowId!, sessionKey: mission.sessionKey!, iccid: activated.esim.iccid };
}

/** Meters `mb` more megabytes and has the app submit the voucher for the new total. */
async function useAndSign(trip: Awaited<ReturnType<typeof openTrip>>, mb: number) {
  await service.processDemoTraffic(trip.id, mb * MB);
  const request = await service.voucherRequest(trip.id);
  return service.submitVoucher(trip.id, mockVoucher(BigInt(request.cumulativeAtomic)));
}

test("the tranche rule: one tranche past the voucher, never past what the deposit pays for", () => {
  // 10 USDC at a 1.5x markup pays for $6.66 of eSIM wallet.
  assert.equal(costCentsPaidBy(10_000_000n, DEFAULT_FUND_FLOW), 666);
  const fund = (voucherAtomic: bigint, fundedCents: number) =>
    nextFundCents({ depositAtomic: 10_000_000n, voucherAtomic, fundedCents }, DEFAULT_FUND_FLOW);
  assert.equal(fund(0n, 0), 250);
  assert.equal(fund(0n, 250), 0);
  assert.equal(fund(3_000_000n, 250), 200);
  // A gap under 50 cents is not worth a provider call.
  assert.equal(fund(300_000n, 250), 0);
  assert.equal(fund(10_000_000n, 450), 216);
  assert.equal(fund(10_000_000n, 666), 0);
});

test("the deposit is confirmed: traveler and session key come from the rail", async () => {
  const trip = await openTrip();
  const mission = await service.getMission(trip.id);
  assert.equal(mission.depositVerified, true);
  assert.ok(mission.travelerAddress);
  assert.ok(mission.sessionKey);
  assert.ok(mission.escrowActiveAt);
  const caps = await service.getCapabilities();
  assert.equal(caps.channelReady, false); // FakeRail is simulated
});

test("activation funds one tranche, not the whole deposit", async () => {
  const trip = await openTrip();
  assert.deepEqual(provider.sim(trip.iccid).fundingRequests.map((f) => f.amountCents), [250]);
  assert.equal((await service.getMission(trip.id)).fundedCents, 250);
});

test("each voucher funds the next part, so the wallet stays one tranche ahead and stops at the deposit", async () => {
  const trip = await openTrip();

  // 400 MB = 1 USDC, which pays for 66 cents of provider cost.
  let res = await useAndSign(trip, 400);
  assert.equal(res.cumulativeAtomic, "1000000");
  assert.equal(res.fundedNowCents, 66);
  assert.equal(res.fundedCents, 316);

  // 1200 MB = 3 USDC covers 200 cents: funded goes to 450.
  res = await useAndSign(trip, 800);
  assert.equal(res.fundedCents, 450);

  // 3600 MB = 9 USDC covers 600 cents; the deposit pays for 666 in total.
  res = await useAndSign(trip, 2400);
  assert.equal(res.fundedCents, 666);
  assert.equal(provider.sim(trip.iccid).fundingRequests.reduce((n, f) => n + f.amountCents, 0), 666);
});

test("without a voucher nothing more is funded: the most AstroAm can lose is one tranche", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 2000 * MB);
  const pass = await service.advance(trip.id, clock);
  assert.equal(pass.fundedCents, 0);
  assert.equal((await service.getMission(trip.id)).fundedCents, 250);
});

test("a voucher is refused when the amount exceeds deposit or is lower than held", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB);

  await assert.rejects(service.submitVoucher(trip.id, mockVoucher(10_000_001n)), /more than the deposit/);

  await service.submitVoucher(trip.id, mockVoucher(1_000_000n));
  await assert.rejects(service.submitVoucher(trip.id, mockVoucher(500_000n)), /higher voucher was already received/);
  assert.equal((await service.voucherRequest(trip.id)).signedAtomic, "1000000");
});

test("the job claims once the voucher holds a tranche, and the claim restarts the timeout", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 400); // 1 USDC: under the 2 USDC claim threshold
  let pass = await service.advance(trip.id, clock);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(rail.getClaimedAtomic(trip.escrowId), 0n);

  await useAndSign(trip, 800); // 3 USDC
  clock = new Date("2026-10-06T12:00:00Z");
  pass = await service.advance(trip.id, clock);
  assert.ok(pass.claimTxHash);
  assert.equal(rail.getClaimedAtomic(trip.escrowId), 3_000_000n);

  const mission = await service.getMission(trip.id);
  assert.equal(mission.claimedAtomic, "3000000");
  assert.equal(mission.claims?.length, 1);
  assert.equal(mission.status, "active");
  assert.equal(mission.escrowActiveAt, "2026-10-06T12:00:00.000Z");

  // Same voucher, next tick: nothing left to claim.
  pass = await service.advance(trip.id, clock);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(rail.getClaimedAtomic(trip.escrowId), 3_000_000n);
});

test("the traveler ends the trip and the backend closes with the session voucher", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 1200); // 3 USDC
  await service.advance(trip.id, clock); // claims 3 USDC
  await service.processDemoTraffic(trip.id, 200 * MB); // 3.5 USDC in total

  const quote = await service.voucherRequest(trip.id);
  assert.equal(quote.cumulativeAtomic, "3500000");
  const closed = await service.settleMission(trip.id, mockVoucher(3_500_000n));

  assert.equal(closed.status, "completed");
  assert.ok(closed.txHash);
  assert.equal(closed.settledUsdc, 3.5);
  assert.equal(closed.refundedUsdc, 6.5);
  assert.equal(provider.sim(trip.iccid).defundPending, true);

  // Asking again returns the same close instead of sending another.
  const again = await service.settleMission(trip.id, mockVoucher(3_500_000n));
  assert.equal(again.txHash, closed.txHash);
});

test("the backend closes by itself a day before the escrow refund timeout", async () => {
  const trip = await openTrip(10, "2026-11-30");
  await useAndSign(trip, 400); // 1 USDC, never claimed

  let pass = await service.advance(trip.id, new Date("2026-10-11T11:00:00Z"));
  assert.equal(pass.closeReason, undefined);

  // Deposit at 12:00 on the 5th, 7-day timeout: refund opens at 12:00 on the 12th. Margin is 1 day.
  pass = await service.advance(trip.id, new Date("2026-10-11T12:00:00Z"));
  assert.equal(pass.closeReason, "timeout_near");
  const mission = await service.getMission(trip.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.autoCloseReason, "timeout_near");
});

test("the backend closes when the deposit is spent or the trip is over", async () => {
  const spent = await openTrip(5);
  await useAndSign(spent, 2000); // 5 USDC, the whole deposit
  let pass = await service.advance(spent.id, clock);
  assert.equal(pass.closeReason, "deposit_spent");

  const over = await openTrip(5, "2026-10-06");
  await useAndSign(over, 400);
  pass = await service.advance(over.id, new Date("2026-10-07T23:00:00Z"));
  assert.equal(pass.closeReason, undefined);
  pass = await service.advance(over.id, new Date("2026-10-08T00:00:00Z"));
  assert.equal(pass.closeReason, "trip_ended");
});

test("a trip due to close with no voucher is left to the escrow refund timeout", async () => {
  const trip = await openTrip(5, "2026-10-06");
  const pass = await service.advance(trip.id, new Date("2026-10-09T00:00:00Z"));
  assert.equal(pass.closeReason, undefined);
  assert.equal(pass.error, undefined);
  assert.equal((await service.getMission(trip.id)).status, "active");
});

test("what the provider charges becomes metered usage on the next pass", async () => {
  const trip = await openTrip();
  // $0.40 charged at a 1.5x markup is 0.60 USDC: 240 MB at 0.0025 USDC/MB.
  provider.setChargedUsd(trip.iccid, 400_000n);
  await service.advance(trip.id, clock);
  let mission = await service.getMission(trip.id);
  assert.equal(mission.meteredBytes, "240000000");
  assert.equal(mission.consumedUsdc, 0.6);
  assert.equal((await service.voucherRequest(trip.id)).cumulativeAtomic, "600000");

  // A lower reading never takes usage back.
  provider.setChargedUsd(trip.iccid, 100_000n);
  await service.advance(trip.id, clock);
  mission = await service.getMission(trip.id);
  assert.equal(mission.meteredBytes, "240000000");
});

test("the job advances every open trip and sweeps what was collected to the treasury", async () => {
  const one = await openTrip();
  const two = await openTrip();
  await useAndSign(one, 1200); // 3 USDC
  await useAndSign(two, 1600); // 4 USDC

  const deps = {
    service,
    rail,
    treasury: { address: TREASURY, minAtomic: 5_000_000n },
    now: () => clock,
  };
  const tick = await runFundFlowOnce(deps);
  assert.equal(tick.advanced.length, 2);
  assert.ok(tick.advanced.every((a) => a.claimTxHash));
  assert.ok(tick.sweepTxHash);
  assert.equal(rail.swept.get(TREASURY), 7_000_000n);

  // Below the minimum, the next tick sweeps nothing.
  assert.equal((await runFundFlowOnce(deps)).sweepTxHash, undefined);
});

test("ending a trip through the backend needs the final voucher from the traveler", async () => {
  const trip = await openTrip();
  await useAndSign(trip, 400);
  // Without any voucher passed, settleMission will use held voucher if exists; if none exists, throws
  const tripNoVoucher = await openTrip();
  await assert.rejects(service.settleMission(tripNoVoucher.id), /needs its final voucher/);
});
