// A voucher is a ceiling the app signs ahead of usage, not a bill. The fund
// flow claims what was used, up to the voucher, so the claimed total never
// exceeds the usage and a close at the used amount always goes through.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService, usedAtomic } from "./services/MissionProductService.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";

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
const MB = 1_000_000;

let service: MissionProductService;
let provider: FakeProvider;
let rail: FakeRail;
let clock: Date;
let log: Record<string, unknown>[];

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = "true";
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.PRICE_PER_MB_RAW;
});

after(() => {
  delete process.env.ENABLE_DEMO_TRAFFIC;
  delete process.env.PRICE_PER_MB_RAW;
});

beforeEach(() => {
  clock = new Date("2026-10-05T12:00:00Z");
  provider = new FakeProvider();
  rail = new FakeRail({ now: () => clock });
  log = [];
  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: provider,
    rail,
    timeoutSeconds: 7 * 24 * 3600,
    logger: (line) => log.push(line),
  });
});

let travelers = 0;

/** A paid and activated 10 USDC trip, each for its own traveler (the provider keeps one eSIM per user). */
async function openTrip(endDate = "2026-10-12") {
  const created = await service.createMission({
    userId: `usr_${++travelers}`,
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate,
    budgetUsdc: 10,
    dailyLimitUsdc: 10,
  });
  const intent = await service.createPaymentIntent(created.id);
  await service.confirmPayment(created.id, intent.intentId, `0xdeposit_${created.id}`);
  await service.activateMission(created.id);
  const mission = await service.getMission(created.id);
  return { id: created.id, escrowId: mission.escrowId!, traveler: mission.travelerAddress! };
}

/** The app signs a voucher for `atomic` with the trip's session key and sends it. */
async function authorize(trip: { id: string; escrowId: string }, atomic: bigint) {
  return service.submitVoucher(trip.id, { cumulativeAtomic: atomic.toString(), signature: await rail.signVoucher(trip.escrowId, atomic) });
}

const used = async (trip: { id: string }) => usedAtomic(await service.getMission(trip.id));
const errors = () => log.filter((line) => line.level === "error");

test("a voucher signed well ahead of usage: the tick claims the usage, and the trip finishes with no further usage", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 1200 * MB); // 3 USDC used
  await authorize(trip, 8_000_000n); // the app authorizes 8 USDC, far ahead

  const pass = await service.advance(trip.id, clock);
  assert.ok(pass.claimTxHash);
  assert.equal(pass.error, undefined);
  // The claim collected the 3 USDC used, not the 8 USDC signed.
  assert.equal(rail.getClaimedAtomic(trip.escrowId), 3_000_000n);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
  let mission = await service.getMission(trip.id);
  assert.equal(mission.claimedAtomic, "3000000");
  assert.equal(mission.claims?.[0]?.cumulativeAtomic, "3000000");

  // The traveler finishes without using anything more.
  const finished = await service.finishMission(trip.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.closeKind, "closed");
  assert.equal(finished.settledUsdc, 3);
  assert.equal(finished.refundedUsdc, 7);
  // The payee received exactly the usage; the traveler everything not used.
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
  assert.equal(rail.escrow.refunded.get(trip.traveler), 7_000_000n);
  mission = await service.getMission(trip.id);
  assert.equal(mission.closedAboveUsageAtomic, undefined);
  assert.deepEqual(errors(), []);
});

test("the same holds when the trip ends through the session voucher or closes by itself", async () => {
  const settled = await openTrip();
  await service.processDemoTraffic(settled.id, 1200 * MB);
  await authorize(settled, 8_000_000n);
  await service.advance(settled.id, clock);
  const closed = await service.settleMission(settled.id);
  assert.equal(closed.settledUsdc, 3);
  assert.equal(closed.refundedUsdc, 7);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);

  // A trip whose end date passed: the job closes it at the usage.
  const over = await openTrip("2026-10-06");
  await service.processDemoTraffic(over.id, 1200 * MB);
  await authorize(over, 8_000_000n);
  await service.advance(over.id, clock); // claims 3 USDC
  const pass = await service.advance(over.id, new Date("2026-10-08T00:00:00Z"));
  assert.equal(pass.closeReason, "trip_ended");
  assert.equal(pass.error, undefined);
  const mission = await service.getMission(over.id);
  assert.equal(mission.settledUsdc, 3);
  assert.equal(mission.refundedUsdc, 7);
  assert.equal(mission.closedAboveUsageAtomic, undefined);
  assert.equal(rail.escrow.payeeBalance, 6_000_000n);
  assert.deepEqual(errors(), []);
});

test("a large voucher alone makes no claim due: the usage has to reach the threshold", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB); // 1 USDC used, under the 2 USDC threshold
  await authorize(trip, 9_000_000n);

  const pass = await service.advance(trip.id, clock);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(pass.error, undefined);
  assert.equal(rail.getClaimedAtomic(trip.escrowId), 0n);
  assert.equal(rail.escrow.payeeBalance, 0n);
});

test("later usage is claimed against the same voucher, never past it, and claimed never exceeds used", async () => {
  const trip = await openTrip();
  await authorize(trip, 8_000_000n); // one voucher, signed before any usage
  const claimedIsWithinUsage = async () => assert.ok(rail.getClaimedAtomic(trip.escrowId) <= (await used(trip)));

  await service.processDemoTraffic(trip.id, 1200 * MB); // 3 USDC
  assert.ok((await service.advance(trip.id, clock)).claimTxHash);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
  await claimedIsWithinUsage();

  await service.processDemoTraffic(trip.id, 400 * MB); // 4 USDC: 1 more, under the threshold
  assert.equal((await service.advance(trip.id, clock)).claimTxHash, undefined);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);

  await service.processDemoTraffic(trip.id, 800 * MB); // 6 USDC
  assert.ok((await service.advance(trip.id, clock)).claimTxHash);
  assert.equal(rail.escrow.payeeBalance, 6_000_000n);
  await claimedIsWithinUsage();

  // Usage runs past the voucher (9 USDC used, 8 signed): only what was signed is collected.
  await service.processDemoTraffic(trip.id, 1200 * MB);
  assert.equal(await used(trip), 9_000_000n);
  const pass = await service.advance(trip.id, clock);
  assert.ok(pass.claimTxHash);
  assert.equal(rail.getClaimedAtomic(trip.escrowId), 8_000_000n);
  assert.equal(rail.escrow.payeeBalance, 8_000_000n);
  assert.equal((await service.getMission(trip.id)).claims?.length, 3);
  await claimedIsWithinUsage();
  assert.deepEqual(errors(), []);
});

test("the claim and the close settle one figure, also with a price that does not divide evenly", async () => {
  // 0.00333 USDC/MB over 1,234,567 bytes leaves a remainder in every unit.
  process.env.PRICE_PER_MB_RAW = "33333";
  try {
    const trip = await openTrip();
    await service.processDemoTraffic(trip.id, 912_345_679);
    const figure = await used(trip);
    assert.equal(figure, 3_041_121n);
    assert.equal((await service.voucherRequest(trip.id)).cumulativeAtomic, figure.toString());
    await authorize(trip, 9_000_000n);

    await service.advance(trip.id, clock);
    assert.equal(rail.getClaimedAtomic(trip.escrowId), figure);

    // Closing at the same figure pays nothing more and does not revert by a unit.
    const finished = await service.finishMission(trip.id);
    assert.equal(finished.closeKind, "closed");
    assert.equal(rail.escrow.payeeBalance, figure);
    assert.equal((await service.getMission(trip.id)).closedAboveUsageAtomic, undefined);
  } finally {
    delete process.env.PRICE_PER_MB_RAW;
  }
});

test("a trip found with more claimed than used still closes, at the claimed total, and says so", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB); // 1 USDC used
  await authorize(trip, 4_000_000n);
  // State from before claims were bounded by usage: 3 USDC collected on that voucher.
  const signature = await rail.signVoucher(trip.escrowId, 4_000_000n);
  await rail.claim({ channelId: trip.escrowId, voucherAmountAtomic: 4_000_000n, signature, claimTotalAtomic: 3_000_000n });

  const finished = await service.finishMission(trip.id);

  // The payee already holds 3 USDC and the contract cannot settle below that.
  assert.equal(finished.status, "completed");
  assert.equal(finished.settledUsdc, 3);
  assert.equal(finished.refundedUsdc, 7);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
  // Recorded in the mission and in the log: closed 2 USDC above its metered usage.
  const mission = await service.getMission(trip.id);
  assert.equal(mission.closedAboveUsageAtomic, "2000000");
  assert.deepEqual(errors(), [
    {
      level: "error",
      msg: "trip closed above its metered usage",
      missionId: trip.id,
      usedAtomic: "1000000",
      settledAtomic: "3000000",
      aboveUsageAtomic: "2000000",
    },
  ]);
});

test("the same stuck state closes through the session voucher and through the job, recorded each time", async () => {
  const stuck = async (endDate?: string) => {
    const trip = await openTrip(endDate);
    await service.processDemoTraffic(trip.id, 400 * MB);
    await authorize(trip, 4_000_000n);
    const signature = await rail.signVoucher(trip.escrowId, 4_000_000n);
    await rail.claim({ channelId: trip.escrowId, voucherAmountAtomic: 4_000_000n, signature, claimTotalAtomic: 3_000_000n });
    return trip;
  };

  const bySession = await stuck();
  const closed = await service.settleMission(bySession.id);
  assert.equal(closed.settledUsdc, 3);
  assert.equal(closed.refundedUsdc, 7);
  assert.equal((await service.getMission(bySession.id)).closedAboveUsageAtomic, "2000000");

  const byJob = await stuck("2026-10-06");
  const pass = await service.advance(byJob.id, new Date("2026-10-08T00:00:00Z"));
  assert.equal(pass.closeReason, "trip_ended");
  assert.equal(pass.error, undefined);
  const mission = await service.getMission(byJob.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.closedAboveUsageAtomic, "2000000");
  assert.equal(errors().length, 2);
});
