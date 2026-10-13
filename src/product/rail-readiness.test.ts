// A deposit is never invited into an escrow the server cannot settle: while
// the rail's operator check fails, no intent is issued and the capabilities
// say payments are off. The check is cached for a short time, and a chain
// that could not be asked is not held against the rail for long.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createProductRouter } from "./api/routes.ts";
import { MissionProductService } from "./services/MissionProductService.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import type { OperatorCheck, PaymentRail } from "../rails/PaymentRail.ts";

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
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const AUTHORIZED: OperatorCheck = { authorized: true, account: ACCOUNT, operator: ACCOUNT, payee: "0x2222222222222222222222222222222222222222" };
const NOT_AUTHORIZED: OperatorCheck = {
  authorized: false,
  account: ACCOUNT,
  reason: "operator_not_authorized",
  detail: `${ACCOUNT} is neither the operator nor the payee`,
};
const UNREACHABLE: OperatorCheck = { authorized: false, account: ACCOUNT, reason: "upstream_unavailable", detail: "HTTP request failed." };

let check: OperatorCheck | Error;
let asked: number;
let clock: number;
let service: MissionProductService;

/** A live rail (FakeRail's chain underneath) whose operator check the test controls. */
function liveRail(): PaymentRail {
  const rail = Object.create(new FakeRail()) as FakeRail & { checkOperator(): Promise<OperatorCheck> };
  Object.defineProperty(rail, "isLive", { value: true });
  rail.checkOperator = async () => {
    asked += 1;
    if (check instanceof Error) throw check;
    return check;
  };
  return rail;
}

before(() => {
  delete process.env.ASTROAM_LIVE_ENABLED;
});

beforeEach(() => {
  check = AUTHORIZED;
  asked = 0;
  clock = 1_000_000;
  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: new FakeProvider(),
    rail: liveRail(),
    logger: () => {},
    now: () => clock,
  });
});

async function newMission() {
  return service.createMission({ destination: BRASIL, startDate: "2026-10-05", endDate: "2026-10-12", budgetUsdc: 10, dailyLimitUsdc: 10 });
}

const isUnavailable = (error: unknown) =>
  error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 503 && /payments are not available/.test(error.message);

test("with an authorized operator key, intents are issued and payments are live", async () => {
  const { id } = await newMission();
  const intent = await service.createPaymentIntent(id);
  assert.ok(intent.intentId);
  await service.confirmPayment(id, intent.intentId, "0xdeposit_1");
  assert.ok((await service.createTopUpIntent(id, 5)).intentId);

  const caps = await service.getCapabilities();
  assert.equal(caps.paymentsLive, true);
  assert.equal(caps.channelReady, true);
  assert.deepEqual(await service.getReadiness(), { ready: true });
});

test("with an unauthorized operator key, creating an intent fails as unavailable and capabilities report paymentsLive false", async () => {
  // A trip paid while the key was still the operator.
  const paid = await newMission();
  const intent = await service.createPaymentIntent(paid.id);
  await service.confirmPayment(paid.id, intent.intentId, "0xdeposit_1");
  const waiting = await newMission();
  const earlier = await service.createPaymentIntent(waiting.id);

  // The payee replaces the operator: this server's key can no longer settle.
  check = NOT_AUTHORIZED;
  clock += 60_000;

  await assert.rejects(service.createPaymentIntent((await newMission()).id), isUnavailable);
  await assert.rejects(service.createTopUpIntent(paid.id, 5), isUnavailable);
  const caps = await service.getCapabilities();
  assert.equal(caps.paymentsLive, false);
  assert.equal(caps.channelReady, false);
  const readiness = await service.getReadiness();
  assert.equal(!readiness.ready && readiness.reason, "operator_not_authorized");
  // No top-up was recorded for the refused intent.
  assert.equal((await service.getMission(paid.id)).topups.length, 0);

  // A deposit already made is still confirmed: the traveler's money is in the escrow either way.
  const confirmed = await service.confirmPayment(waiting.id, earlier.intentId, "0xdeposit_2");
  assert.equal(confirmed.status, "paid");
});

test("the refusal reaches the app as a 503", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", createProductRouter(service));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { id } = await newMission();
    check = NOT_AUTHORIZED;
    const res = await fetch(`${baseUrl}/api/missions/${id}/payment-intent`, { method: "POST" });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, "payment_intent_error");
    assert.match(body.message, /payments are not available/);
    // The message names the reason, never an address or a key.
    assert.equal(body.message.includes("0x"), false);

    const caps = (await (await fetch(`${baseUrl}/api/capabilities`)).json()) as { paymentsLive: boolean };
    assert.equal(caps.paymentsLive, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the chain is not asked on every request: the answer is reused until it expires", async () => {
  for (let i = 0; i < 5; i++) {
    await service.createPaymentIntent((await newMission()).id);
    await service.getCapabilities();
    await service.getReadiness();
  }
  assert.equal(asked, 1);

  // Requests that arrive together share one question.
  clock += 60_000;
  await Promise.all([service.getReadiness(), service.getCapabilities(), service.getReadiness()]);
  assert.equal(asked, 2);

  clock += 59_999;
  await service.getReadiness();
  assert.equal(asked, 2);
  clock += 1;
  await service.getReadiness();
  assert.equal(asked, 3);
});

test("a key that is not authorized is asked about again within seconds, so a fix shows up", async () => {
  check = NOT_AUTHORIZED;
  const { id } = await newMission();
  await assert.rejects(service.createPaymentIntent(id), isUnavailable);
  assert.equal(asked, 1);

  // The payee calls setOperator with this server's key.
  check = AUTHORIZED;
  clock += 14_999;
  await assert.rejects(service.createPaymentIntent(id), isUnavailable);
  assert.equal(asked, 1);
  clock += 1;
  assert.ok((await service.createPaymentIntent(id)).intentId);
  assert.equal(asked, 2);
});

test("a chain that could not be asked refuses intents, but is not held as 'not authorized' for long", async () => {
  const { id } = await newMission();

  for (const failure of [UNREACHABLE, new Error("socket hang up")]) {
    check = failure;
    const before = asked;
    await assert.rejects(service.createPaymentIntent(id), isUnavailable);
    const readiness = await service.getReadiness();
    assert.equal(!readiness.ready && readiness.reason, "upstream_unavailable");
    assert.equal((await service.getCapabilities()).paymentsLive, false);
    assert.equal(asked, before + 1);

    // The RPC answers again: three seconds later the rail is ready.
    check = AUTHORIZED;
    clock += 2_999;
    await assert.rejects(service.createPaymentIntent(id), isUnavailable);
    clock += 1;
    assert.ok((await service.createPaymentIntent(id)).intentId);
    assert.equal((await service.getCapabilities()).paymentsLive, true);
    clock += 60_000;
  }
});

test("the simulated rail has no key of its own and is always ready", async () => {
  const demo = new MissionProductService({ repo: new MemoryRepo(), connectivity: new FakeProvider(), rail: new FakeRail(), logger: () => {} });
  assert.deepEqual(await demo.getReadiness(), { ready: true });
  const { id } = await demo.createMission({ destination: BRASIL, startDate: "2026-10-05", endDate: "2026-10-12", budgetUsdc: 10, dailyLimitUsdc: 10 });
  assert.ok((await demo.createPaymentIntent(id)).intentId);
  // Simulated payments are not live, as before.
  assert.equal((await demo.getCapabilities()).paymentsLive, false);
});
