import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServerApp } from "./app.ts";
import { bootProductService } from "../product/runtime/product-boot.ts";
import { MissionProductService } from "../product/services/MissionProductService.ts";
import { FileMissionRepository } from "../product/persistence/MissionRepository.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import type { OperatorCheck } from "../rails/PaymentRail.ts";

async function withApp(fn: (baseUrl: string) => Promise<void>, productService?: MissionProductService) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astroam-app-"));
  const app = createServerApp({ productService: productService ?? bootProductService({ DATA_DIR: dir }) });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /health is always 200", async () => {
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "alive" });
  });
});

test("GET /ready reports the payment rail and mode", async () => {
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, "ready");
    assert.equal(body.network, "demo:local");
    assert.equal(body.paymentsLive, false);
    assert.equal(body.mode, "demo");
  });
});

test("GET /ready is 503 while the rail's key may not collect or close, and 200 once it may", async () => {
  const account = "0x1111111111111111111111111111111111111111";
  let check: OperatorCheck = {
    authorized: false,
    account,
    reason: "operator_not_authorized",
    detail: `${account} is neither the operator nor the payee`,
  };
  let asked = 0;
  class KeyedRail extends FakeRail {
    async checkOperator(): Promise<OperatorCheck> {
      asked += 1;
      return check;
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astroam-app-"));
  // The answer is cached for a short time: the clock moves it past each expiry.
  let clock = 0;
  const service = new MissionProductService({
    repo: new FileMissionRepository(dir),
    connectivity: new FakeProvider(),
    rail: new KeyedRail(),
    now: () => clock,
  });
  await withApp(async (baseUrl) => {
    const notReady = await fetch(`${baseUrl}/ready`);
    assert.equal(notReady.status, 503);
    const body = (await notReady.json()) as Record<string, unknown>;
    assert.equal(body.status, "unavailable");
    assert.equal(body.reason, "operator_not_authorized");
    assert.match(String(body.detail), /neither the operator nor the payee/);
    // The process is still alive: only readiness is withheld.
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    // Asked again at once, the chain is not: the answer is reused.
    assert.equal((await fetch(`${baseUrl}/ready`)).status, 503);
    assert.equal(asked, 1);

    clock += 60_000;
    check = { authorized: false, account, reason: "upstream_unavailable", detail: "could not read operator() and payee()" };
    const unreachable = await fetch(`${baseUrl}/ready`);
    assert.equal(unreachable.status, 503);
    assert.equal(((await unreachable.json()) as Record<string, unknown>).reason, "upstream_unavailable");

    // An unreachable chain is only held for a few seconds.
    clock += 5_000;
    check = { authorized: true, account, operator: account, payee: "0x2222222222222222222222222222222222222222" };
    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.equal(((await ready.json()) as Record<string, unknown>).status, "ready");
    assert.equal(asked, 3);
  }, service);
});

test("the mission API is mounted under /api", async () => {
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/capabilities`);
    assert.equal(res.status, 200);
    const caps = (await res.json()) as Record<string, unknown>;
    assert.equal(caps.paymentRail, "Simulated payments");
  });
});

test("an uncaught error answers JSON, never an HTML stack trace", async () => {
  const failing = {
    async getCapabilities() {
      throw new Error("boom");
    },
  } as unknown as MissionProductService;
  await withApp(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "internal_error");
  }, failing);
});
