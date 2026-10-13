import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService } from "./services/MissionProductService.ts";
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
    timeoutSeconds: 7 * 24 * 3600,
    logger: () => {},
  });
});

/** A paid trip; with `activate` it also has its eSIM and first tranche. */
async function openTrip(activate = true) {
  const created = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate: "2026-10-12",
    budgetUsdc: 10,
    dailyLimitUsdc: 10,
  });
  const intent = await service.createPaymentIntent(created.id);
  await service.confirmPayment(created.id, intent.intentId, "0xdeposit_tx_hash_123");
  const mission = await service.getMission(created.id);
  if (!activate) return { id: created.id, escrowId: mission.escrowId!, iccid: "" };
  const activated = await service.activateMission(created.id);
  return { id: created.id, escrowId: mission.escrowId!, iccid: activated.esim.iccid };
}

/** Makes the next call to `target[method]` wait until `release()` is called; `entered` resolves when it arrives. */
function gateNextCall<T extends object>(target: T, method: keyof T & string) {
  const original = (target[method] as (...args: unknown[]) => Promise<unknown>).bind(target);
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  let gated = false;
  (target as Record<string, unknown>)[method] = async (...args: unknown[]) => {
    if (!gated) {
      gated = true;
      enter();
      await open;
    }
    return original(...args);
  };
  return { entered, release };
}

test("a top-up confirmed twice with the same transaction credits once", async () => {
  const trip = await openTrip();
  const intent = await service.createTopUpIntent(trip.id, 5);

  const first = await service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_tx");
  const second = await service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_tx");

  assert.equal(second.txHash, first.txHash);
  const mission = await service.getMission(trip.id);
  assert.equal(mission.budgetUsdc, 15);
  assert.equal(mission.balanceUsdc, 15);
});

test("two concurrent confirmations of the same top-up credit once, even if the rail accepts the transaction twice", async () => {
  const trip = await openTrip();
  const intent = await service.createTopUpIntent(trip.id, 5);

  // A chain verifies the same transaction as valid every time it is asked.
  const confirmDeposit = rail.confirmDeposit.bind(rail);
  const verdicts = new Map<string, ReturnType<typeof rail.confirmDeposit>>();
  rail.confirmDeposit = (input) => {
    if (!verdicts.has(input.txHash)) verdicts.set(input.txHash, confirmDeposit(input));
    return verdicts.get(input.txHash)!;
  };

  const topUp = provider.topUp.bind(provider);
  let wallets = 0;
  provider.topUp = (...args) => {
    wallets += 1;
    return topUp(...args);
  };

  const results = await Promise.all([
    service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_tx"),
    service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_tx"),
  ]);

  assert.equal(results[0].txHash, results[1].txHash);
  assert.equal(wallets, 1);
  const mission = await service.getMission(trip.id);
  assert.equal(mission.budgetUsdc, 15);
  assert.equal(mission.balanceUsdc, 15);
  assert.equal(mission.topups.filter((t) => t.status === "settled").length, 1);
});

test("pausing while the usage tick is in flight leaves the trip paused and keeps the usage reading", async () => {
  const trip = await openTrip();
  // $0.40 charged at the default markup is 240 MB of metered usage.
  provider.setChargedUsd(trip.iccid, 400_000n);
  const gate = gateNextCall(provider, "getUsage");

  const tick = service.advance(trip.id, clock);
  await gate.entered; // the tick has loaded the trip and is reading the provider
  const pause = service.pauseMission(trip.id);
  gate.release();
  await Promise.all([tick, pause]);

  const mission = await service.getMission(trip.id);
  assert.equal(mission.status, "paused");
  assert.equal(mission.esimStatus, "paused");
  assert.equal(mission.meteredBytes, "240000000");
});

test("resuming while the usage tick is in flight leaves the trip active and keeps the usage reading", async () => {
  const trip = await openTrip();
  await service.pauseMission(trip.id);
  provider.setChargedUsd(trip.iccid, 400_000n);
  const gate = gateNextCall(provider, "getUsage");

  const tick = service.advance(trip.id, clock);
  await gate.entered;
  const resume = service.resumeMission(trip.id);
  gate.release();
  await Promise.all([tick, resume]);

  const mission = await service.getMission(trip.id);
  assert.equal(mission.status, "active");
  assert.equal(mission.esimStatus, "active");
  assert.equal(mission.meteredBytes, "240000000");
});

test("demo traffic sent concurrently adds up: no reading is lost", async () => {
  const trip = await openTrip();

  await Promise.all(Array.from({ length: 5 }, () => service.processDemoTraffic(trip.id, 10 * MB)));

  const mission = await service.getMission(trip.id);
  assert.equal(mission.meteredBytes, String(50 * MB));
  assert.equal(mission.consumedMb, 50);
});

test("two concurrent cancellations refund once", async () => {
  const trip = await openTrip(false);
  const closeChannel = rail.closeChannel.bind(rail);
  let closes = 0;
  rail.closeChannel = (...args) => {
    closes += 1;
    return closeChannel(...args);
  };

  const [first, second] = await Promise.all([service.cancelMission(trip.id), service.cancelMission(trip.id)]);

  assert.equal(closes, 1);
  assert.equal(first.status, "cancelled");
  assert.equal(second.txHash, first.txHash);
});

test("a claim that landed but was not recorded is taken from the rail, not sent twice", async () => {
  const trip = await openTrip();
  await service.processDemoTraffic(trip.id, 1200 * MB); // 3 USDC
  const request = await service.voucherRequest(trip.id);
  const signature = await rail.signVoucher(trip.escrowId, BigInt(request.cumulativeAtomic));
  const voucher = { cumulativeAtomic: request.cumulativeAtomic, signature };
  await service.submitVoucher(trip.id, voucher);

  // The claim reaches the chain, and the process dies before saving it.
  await rail.claim({ channelId: trip.escrowId, voucherAmountAtomic: BigInt(voucher.cumulativeAtomic), signature: voucher.signature });
  const claim = rail.claim.bind(rail);
  let claims = 0;
  rail.claim = (...args) => {
    claims += 1;
    return claim(...args);
  };

  const pass = await service.advance(trip.id, clock);

  assert.equal(pass.error, undefined);
  assert.equal(pass.claimTxHash, undefined);
  assert.equal(claims, 0);
  const mission = await service.getMission(trip.id);
  assert.equal(mission.claimedAtomic, "3000000");
  assert.equal(mission.claims, undefined);
});

test("two concurrent activations provision one eSIM and return the same one", async () => {
  const trip = await openTrip(false);
  const provisionEsim = provider.provisionEsim.bind(provider);
  let provisions = 0;
  provider.provisionEsim = (...args) => {
    provisions += 1;
    return provisionEsim(...args);
  };
  const gate = gateNextCall(provider, "provisionEsim");

  const first = service.activateMission(trip.id);
  await gate.entered; // the first call is provisioning
  const second = service.activateMission(trip.id);
  gate.release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(provisions, 1);
  assert.equal(a.esim.iccid, b.esim.iccid);
  assert.equal((await service.getMission(trip.id)).iccid, a.esim.iccid);
});

test("creating a top-up intent while an earlier one is confirmed loses neither update", async () => {
  const trip = await openTrip();
  const earlier = await service.createTopUpIntent(trip.id, 5);
  const gate = gateNextCall(provider, "topUp");

  const confirm = service.confirmTopUpPayment(trip.id, earlier.intentId, "0xtopup_tx");
  await gate.entered; // the confirmation has loaded the trip and is funding the eSIM wallet
  const create = service.createTopUpIntent(trip.id, 3);
  gate.release();
  const [, later] = await Promise.all([confirm, create]);

  const mission = await service.getMission(trip.id);
  assert.equal(mission.topups.length, 2);
  assert.equal(mission.topups.find((t) => t.intentId === earlier.intentId)?.status, "settled");
  assert.equal(mission.topups.find((t) => t.intentId === later.intentId)?.status, "pending");
  assert.equal(mission.budgetUsdc, 15);
});
