// The auto-close on the escrow's refund timeout uses the timeout the contract
// reports, never a default the backend assumes.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService } from "./services/MissionProductService.ts";
import { DEFAULT_FUND_FLOW } from "./services/fund-flow.ts";
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
const DAY = 24 * 3600;
const START = new Date("2026-10-05T12:00:00Z");
const atDay = (days: number) => new Date(START.getTime() + days * DAY * 1000);

let rail: FakeRail;
let service: MissionProductService;
let lines: Record<string, unknown>[];

before(() => {
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.PRICE_PER_MB_RAW;
});

function boot(options: { timeoutSeconds: number; closeMarginSeconds?: number }) {
  lines = [];
  rail = new FakeRail({ now: () => START, timeoutSeconds: options.timeoutSeconds });
  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: new FakeProvider(),
    rail,
    fundFlow: { ...DEFAULT_FUND_FLOW, closeMarginSeconds: options.closeMarginSeconds ?? DEFAULT_FUND_FLOW.closeMarginSeconds },
    logger: (line) => lines.push(line),
  });
}

beforeEach(() => boot({ timeoutSeconds: 30 * DAY }));

/** A paid and activated trip that runs for 60 days, with a voucher signed. */
async function longTrip() {
  const created = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate: "2026-12-04",
    budgetUsdc: 10,
    dailyLimitUsdc: 10,
  });
  const intent = await service.createPaymentIntent(created.id);
  await service.confirmPayment(created.id, intent.intentId, `0xdeposit_${created.id}`);
  await service.activateMission(created.id);
  const mission = await service.getMission(created.id);
  await service.submitVoucher(created.id, {
    cumulativeAtomic: "1000000",
    signature: await rail.signVoucher(mission.escrowId!, 1_000_000n),
  });
  return created.id;
}

test("a rail with a 30 day timeout does not close an idle trip at day 6 and closes it at day 29", async () => {
  const id = await longTrip();

  assert.equal((await service.advance(id, atDay(6))).closeReason, undefined);
  assert.equal((await service.advance(id, atDay(28.9))).closeReason, undefined);
  const pass = await service.advance(id, atDay(29));

  assert.equal(pass.closeReason, "timeout_near");
  assert.equal((await service.getMission(id)).status, "completed");
});

test("the close follows the timeout of the contract: a 7 day escrow closes at day 6", async () => {
  boot({ timeoutSeconds: 7 * DAY });
  const id = await longTrip();

  assert.equal((await service.advance(id, atDay(5.9))).closeReason, undefined);
  assert.equal((await service.advance(id, atDay(6))).closeReason, "timeout_near");
});

test("a timeout that cannot be read skips the timeout close for that pass, and a later pass uses it", async () => {
  const id = await longTrip();
  const read = rail.readTimeoutSeconds.bind(rail);
  rail.readTimeoutSeconds = async () => {
    rail.readTimeoutSeconds = read;
    throw new Error("rpc unreachable");
  };

  const skipped = await service.advance(id, atDay(40));
  assert.equal(skipped.closeReason, undefined);
  assert.equal(skipped.error, undefined);
  assert.equal((await service.getMission(id)).status, "active");
  const logged = lines.find((line) => line.msg === "escrow timeout unknown: skipping the timeout auto-close");
  assert.equal(logged?.level, "error");
  assert.equal(logged?.detail, "rpc unreachable");

  assert.equal((await service.advance(id, atDay(40))).closeReason, "timeout_near");
});

test("a timeout that cannot be read still lets the trip close when it ends", async () => {
  const id = await longTrip();
  rail.readTimeoutSeconds = async () => {
    throw new Error("rpc unreachable");
  };

  assert.equal((await service.advance(id, atDay(40))).closeReason, undefined);
  const pass = await service.advance(id, new Date("2026-12-07T00:00:00Z"));

  assert.equal(pass.closeReason, "trip_ended");
});

test("a margin that is not smaller than the timeout is reported once and never closes on the timeout", async () => {
  boot({ timeoutSeconds: DAY, closeMarginSeconds: DAY });
  const id = await longTrip();

  assert.equal((await service.advance(id, atDay(2))).closeReason, undefined);
  assert.equal((await service.advance(id, atDay(3))).closeReason, undefined);

  const reports = lines.filter((line) => String(line.msg).startsWith("ESCROW_CLOSE_MARGIN_SECONDS"));
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.level, "error");
  assert.equal((await service.getMission(id)).status, "active");
});
