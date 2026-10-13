// How a trip closes: the deposit counts as spent only when the usage reaches
// it, the eSIM wallet is defunded after the escrow closed, and finishing a
// trip twice or after a crash ends in the same state.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService } from "./services/MissionProductService.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";

/** Keeps missions in memory; `failSaveWhen` makes the next matching save throw, once. */
class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>();
  failSaveWhen?: (mission: ProductMission) => boolean;
  async save(mission: ProductMission): Promise<void> {
    if (this.failSaveWhen?.(mission)) {
      this.failSaveWhen = undefined;
      throw new Error("disk full");
    }
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
let repo: MemoryRepo;
let provider: FakeProvider;
let rail: FakeRail;
let clock: Date;
let closeCalls: number;
let refundUnusedCalls: string[];

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
  repo = new MemoryRepo();
  provider = new FakeProvider();
  rail = new FakeRail({ now: () => clock });
  service = new MissionProductService({
    repo,
    connectivity: provider,
    rail,
    timeoutSeconds: 7 * 24 * 3600,
    logger: () => {},
  });

  closeCalls = 0;
  const closeChannel = rail.closeChannel.bind(rail);
  rail.closeChannel = (...args) => {
    closeCalls += 1;
    return closeChannel(...args);
  };
  refundUnusedCalls = [];
  const refundUnused = provider.refundUnused.bind(provider);
  provider.refundUnused = (iccid) => {
    refundUnusedCalls.push(iccid);
    return refundUnused(iccid);
  };
});

/** A paid and activated 10 USDC trip. */
async function openTrip() {
  const created = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate: "2026-10-12",
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

/** The next close the rail is asked for fails as if the chain refused it. */
function failNextClose() {
  const closeChannel = rail.closeChannel.bind(rail);
  rail.closeChannel = async (...args) => {
    closeCalls += 1;
    rail.closeChannel = closeChannel;
    return { kind: "failed", reason: "upstream_unavailable", detail: "rpc unreachable" };
  };
}

test("a voucher signed up to the whole budget with little usage does not close the trip", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB); // 1 USDC used of 10
  await authorize(trip, 10_000_000n); // the app signs the full budget ahead of usage

  const pass = await service.advance(trip.id, clock);

  assert.equal(pass.closeReason, undefined);
  assert.equal(pass.closeTxHash, undefined);
  assert.equal(pass.error, undefined);
  assert.equal((await service.getMission(trip.id)).status, "active");
  assert.equal(closeCalls, 0);
});

test("usage that reaches the deposit closes the trip, settled at the usage", async () => {
  const trip = await openTrip();
  await authorize(trip, 10_000_000n);
  await service.processDemoTraffic(trip.id, 4000 * MB); // 10 USDC used: the whole deposit

  const pass = await service.advance(trip.id, clock);

  assert.equal(pass.closeReason, "deposit_spent");
  const mission = await service.getMission(trip.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.settledUsdc, 10);
  assert.equal(mission.refundedUsdc, 0);
});

test("a close that fails leaves the eSIM funded; a close that lands defunds it once", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 1200 * MB); // 3 USDC
  await authorize(trip, 8_000_000n);

  failNextClose();
  await assert.rejects(() => service.finishMission(trip.id), /Could not close the payment channel: rpc unreachable/);
  assert.deepEqual(refundUnusedCalls, []);
  assert.equal((await service.getMission(trip.id)).status, "active");

  // The same through the session voucher and through the automatic close.
  failNextClose();
  await assert.rejects(() => service.settleMission(trip.id), /Could not close the payment channel/);
  failNextClose();
  const pass = await service.advance(trip.id, new Date("2026-10-30T00:00:00Z"));
  assert.match(pass.error ?? "", /Could not close the payment channel/);
  assert.deepEqual(refundUnusedCalls, []);
  assert.equal((await service.getMission(trip.id)).status, "active");

  const finished = await service.finishMission(trip.id);
  assert.equal(finished.settledUsdc, 3);
  assert.equal(refundUnusedCalls.length, 1);
  assert.equal(closeCalls, 4);
});

test("the eSIM is defunded after the escrow is closed, not before", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB);
  await authorize(trip, 4_000_000n);

  const order: string[] = [];
  const closeChannel = rail.closeChannel.bind(rail);
  rail.closeChannel = async (...args) => {
    const outcome = await closeChannel(...args);
    order.push("close");
    return outcome;
  };
  const refundUnused = provider.refundUnused.bind(provider);
  provider.refundUnused = (iccid) => {
    order.push("defund");
    return refundUnused(iccid);
  };

  await service.settleMission(trip.id);

  assert.deepEqual(order, ["close", "defund"]);
});

test("a defund that fails does not fail the close", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 400 * MB);
  await authorize(trip, 4_000_000n);
  provider.refundUnused = async () => {
    throw new Error("provider down");
  };

  const finished = await service.finishMission(trip.id);

  assert.equal(finished.status, "completed");
  assert.equal(finished.settledUsdc, 1);
});

test("finishing twice sends one close and returns the same result", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 1200 * MB); // 3 USDC
  await authorize(trip, 8_000_000n);

  const first = await service.finishMission(trip.id);
  const second = await service.finishMission(trip.id);

  assert.deepEqual(second, first);
  assert.equal(first.status, "completed");
  assert.equal(first.settledUsdc, 3);
  assert.ok(first.txHash);
  assert.equal(closeCalls, 1);
  assert.equal(refundUnusedCalls.length, 1);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
});

test("finishing a trip the automatic close already completed returns its result and sends nothing", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 1200 * MB);
  await authorize(trip, 8_000_000n);
  const pass = await service.advance(trip.id, new Date("2026-10-30T00:00:00Z"));
  assert.equal(pass.closeReason, "trip_ended");

  const finished = await service.finishMission(trip.id);

  assert.equal(finished.status, "completed");
  assert.equal(finished.txHash, pass.closeTxHash);
  assert.equal(finished.settledUsdc, 3);
  assert.equal(closeCalls, 1);
});

test("the close lands but the save fails: a later finish completes the trip from the chain", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 1200 * MB); // 3 USDC
  await authorize(trip, 8_000_000n);

  // The server stops after the close transaction, before the record is saved.
  repo.failSaveWhen = (mission) => mission.status === "completed";
  await assert.rejects(() => service.finishMission(trip.id), /disk full/);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
  assert.equal((await service.getMission(trip.id)).status, "active");

  const finished = await service.finishMission(trip.id);

  assert.equal(finished.status, "completed");
  assert.equal(finished.settledUsdc, 3);
  assert.equal(finished.refundedUsdc, 7);
  assert.equal(finished.txHash, undefined);
  const mission = await service.getMission(trip.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.esimStatus, "disabled");
  assert.equal(mission.closeTxHash, undefined);
  assert.equal(mission.closedAboveUsageAtomic, undefined);
  // Nothing more moved on chain, and asking again changes nothing.
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
  assert.deepEqual(await service.finishMission(trip.id), finished);
  assert.equal(closeCalls, 2);
});

test("the same crash recovers through the session voucher and the automatic close", async () => {
  const bySession = await openTrip();
  await service.processDemoTraffic(bySession.id, 1200 * MB);
  await authorize(bySession, 8_000_000n);
  repo.failSaveWhen = (mission) => mission.status === "completed";
  await assert.rejects(() => service.settleMission(bySession.id), /disk full/);
  const closed = await service.settleMission(bySession.id);
  assert.equal(closed.status, "completed");
  assert.equal(closed.settledUsdc, 3);
  assert.equal(closed.refundedUsdc, 7);

  const byJob = await openTrip();
  await service.processDemoTraffic(byJob.id, 1200 * MB);
  await authorize(byJob, 8_000_000n);
  repo.failSaveWhen = (mission) => mission.status === "completed";
  const failed = await service.advance(byJob.id, new Date("2026-10-30T00:00:00Z"));
  assert.match(failed.error ?? "", /disk full/);
  const retried = await service.advance(byJob.id, new Date("2026-10-30T00:00:00Z"));
  assert.equal(retried.error, undefined);
  assert.equal(retried.closeReason, "trip_ended");
  const mission = await service.getMission(byJob.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.settledUsdc, 3);
  assert.equal(mission.autoCloseReason, "trip_ended");
});
