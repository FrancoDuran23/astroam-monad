import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { astroAmEscrowAbi } from "./abi.ts";

// Foundry's build output is not committed. Without it there is nothing to
// compare against, so the test is skipped rather than requiring Foundry.
const ARTIFACT = join(import.meta.dirname, "..", "..", "..", "contracts", "out", "AstroAmEscrow.sol", "AstroAmEscrow.json");
const skip = existsSync(ARTIFACT) ? false : "contracts/out is absent (run: npm run contracts:build)";

test("the committed escrow ABI equals the Foundry build output", { skip }, () => {
  const compiled = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: unknown[] };
  assert.deepEqual(
    astroAmEscrowAbi,
    compiled.abi,
    "src/shared/monad/abi.ts is out of date. Run: npm run contracts:build && npm run contracts:abi",
  );
});
