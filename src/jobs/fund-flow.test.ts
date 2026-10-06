import { test } from "node:test";
import assert from "node:assert/strict";
import { runFundFlowOnce, startFundFlowLoop } from "./fund-flow.ts";
import type { AdvanceResult } from "../product/services/MissionProductService.ts";
import { FakeRail } from "../rails/FakeRail.ts";

test("runFundFlowOnce advances open missions and executes treasury sweep", async () => {
  const advancedIds: string[] = [];
  const fakeService = {
    async openMissionIds() {
      return ["m1", "m2"];
    },
    async advance(id: string): Promise<AdvanceResult> {
      advancedIds.push(id);
      return { missionId: id, fundedCents: 100, claimTxHash: `0xclaim_${id}` };
    },
  };

  const fakeRail = new FakeRail();
  fakeRail.creditPayeeAtomic(15_000_000n);

  const tick = await runFundFlowOnce({
    service: fakeService,
    rail: fakeRail,
    treasury: { address: "0x1111111111111111111111111111111111111111", minAtomic: 10_000_000n },
  });

  assert.deepEqual(advancedIds, ["m1", "m2"]);
  assert.equal(tick.advanced.length, 2);
  assert.ok(tick.sweepTxHash);
  assert.equal(tick.sweepError, undefined);
  assert.equal(fakeRail.swept.get("0x1111111111111111111111111111111111111111"), 15_000_000n);
});

test("runFundFlowOnce does not fail tick if one mission throws or fails", async () => {
  const fakeService = {
    async openMissionIds() {
      return ["fail-m", "ok-m"];
    },
    async advance(id: string): Promise<AdvanceResult> {
      if (id === "fail-m") {
        return { missionId: id, fundedCents: 0, error: "timeout" };
      }
      return { missionId: id, fundedCents: 50 };
    },
  };

  const fakeRail = new FakeRail();
  const tick = await runFundFlowOnce({
    service: fakeService,
    rail: fakeRail,
  });

  assert.equal(tick.advanced.length, 2);
  assert.equal(tick.advanced[0]!.error, "timeout");
  assert.equal(tick.advanced[1]!.fundedCents, 50);
});

test("runFundFlowOnce handles treasury sweep failure gracefully", async () => {
  const fakeService = {
    async openMissionIds() {
      return ["m1"];
    },
    async advance(id: string): Promise<AdvanceResult> {
      return { missionId: id, fundedCents: 0 };
    },
  };

  const fakeRail = new FakeRail();
  fakeRail.sweep = async () => {
    throw new Error("RPC unreachable");
  };

  const tick = await runFundFlowOnce({
    service: fakeService,
    rail: fakeRail,
    treasury: { address: "0x1111111111111111111111111111111111111111", minAtomic: 1_000_000n },
  });

  assert.equal(tick.advanced.length, 1);
  assert.equal(tick.sweepError, "RPC unreachable");
});

test("startFundFlowLoop runs and can be stopped", async () => {
  let runs = 0;
  const fakeService = {
    async openMissionIds() {
      runs++;
      return [];
    },
    async advance(id: string): Promise<AdvanceResult> {
      return { missionId: id, fundedCents: 0 };
    },
  };
  const fakeRail = new FakeRail();

  const stop = startFundFlowLoop({ service: fakeService, rail: fakeRail }, 10_000);
  assert.equal(typeof stop, "function");
  assert.ok(runs >= 1);
  stop();
});
