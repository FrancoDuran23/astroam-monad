import { test } from "node:test";
import assert from "node:assert/strict";
import { runFundFlowOnce, startFundFlowLoop } from "./fund-flow.ts";
import type { AdvanceResult } from "../product/services/MissionProductService.ts";

test("runFundFlowOnce advances every open mission and moves no funds itself", async () => {
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

  const tick = await runFundFlowOnce({ service: fakeService });

  assert.deepEqual(advancedIds, ["m1", "m2"]);
  // The tick is the list of what each trip did: nothing is collected or moved by the job.
  assert.deepEqual(tick, {
    advanced: [
      { missionId: "m1", fundedCents: 100, claimTxHash: "0xclaim_m1" },
      { missionId: "m2", fundedCents: 100, claimTxHash: "0xclaim_m2" },
    ],
  });
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

  const tick = await runFundFlowOnce({ service: fakeService });

  assert.equal(tick.advanced.length, 2);
  assert.equal(tick.advanced[0]!.error, "timeout");
  assert.equal(tick.advanced[1]!.fundedCents, 50);
});

test("runFundFlowOnce reports and survives a failure to list the open missions", async () => {
  const lines: Record<string, unknown>[] = [];
  const fakeService = {
    async openMissionIds(): Promise<string[]> {
      throw new Error("disk unreadable");
    },
    async advance(id: string): Promise<AdvanceResult> {
      return { missionId: id, fundedCents: 0 };
    },
  };

  const tick = await runFundFlowOnce({ service: fakeService, logger: (line) => lines.push(line) });

  assert.deepEqual(tick.advanced, []);
  assert.equal(lines[0]?.detail, "disk unreadable");
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

  const stop = startFundFlowLoop({ service: fakeService }, 10_000);
  assert.equal(typeof stop, "function");
  assert.ok(runs >= 1);
  stop();
});
