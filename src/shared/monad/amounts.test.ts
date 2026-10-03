import { test } from "node:test";
import assert from "node:assert/strict";
import { atomicToRaw, formatAtomic, rawToAtomicCeil, rawToAtomicFloor, usdcToAtomic } from "./amounts.ts";

test("raw (1e-7) to atomic (1e-6) rounds up for vouchers and down for settlement", () => {
  assert.equal(rawToAtomicCeil(7_500_172n), 750_018n);
  assert.equal(rawToAtomicFloor(7_500_172n), 750_017n);
  assert.equal(rawToAtomicCeil(50_000_000n), 5_000_000n);
  assert.equal(rawToAtomicFloor(50_000_000n), 5_000_000n);
});

test("atomic back to raw is exact", () => {
  assert.equal(atomicToRaw(5_000_000n), 50_000_000n);
});

test("USDC amounts convert exactly to 6 decimals", () => {
  assert.equal(usdcToAtomic(5), 5_000_000n);
  assert.equal(usdcToAtomic(0.0025), 2_500n);
  assert.equal(usdcToAtomic(1.875), 1_875_000n);
});

test("formatAtomic trims trailing zeros", () => {
  assert.equal(formatAtomic(5_000_000n), "5");
  assert.equal(formatAtomic(1_875_000n), "1.875");
});
