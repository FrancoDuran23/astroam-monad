// How the rail is picked and keyed from the environment. No chain needed:
// building a MonadRail sends nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymentRail } from "./createPaymentRail.ts";
import { FakeRail } from "./FakeRail.ts";
import { LEGACY_KEY_VAR, MonadRail, OPERATOR_KEY_VAR } from "./MonadRail.ts";

// anvil's well-known dev accounts 0 and 2: public test keys, never funded on a real network.
const A_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OPERATOR_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function monadEnv(extra: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    PAYMENT_RAIL: "monad",
    MONAD_ESCROW_ADDRESS: ESCROW,
    // A port nothing listens on: these tests must not reach a network.
    MONAD_RPC_URL: "http://127.0.0.1:9",
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "rail-env-")),
    ...extra,
  };
}

test("the default rail is the simulated one", () => {
  assert.ok(createPaymentRail({}) instanceof FakeRail);
  assert.ok(createPaymentRail({ PAYMENT_RAIL: "fake" }) instanceof FakeRail);
  assert.throws(() => createPaymentRail({ PAYMENT_RAIL: "solana" }), /not available/);
});

test("the Monad rail is keyed with the operator key", () => {
  assert.equal(OPERATOR_KEY_VAR, "MONAD_OPERATOR_PRIVATE_KEY");
  const rail = createPaymentRail(monadEnv({ [OPERATOR_KEY_VAR]: OPERATOR_KEY }));
  assert.ok(rail instanceof MonadRail);
  assert.equal(rail.isLive, true);
  assert.equal(rail.voucherSigning, "traveler");
});

test("with only the old payee key variable set, start-up fails naming the new variable", () => {
  assert.throws(
    () => createPaymentRail(monadEnv({ [LEGACY_KEY_VAR]: A_KEY })),
    (error: Error) => {
      assert.match(error.message, /MONAD_OPERATOR_PRIVATE_KEY/);
      assert.match(error.message, new RegExp(`${LEGACY_KEY_VAR} is no longer read`));
      // The message names variables, never a key.
      assert.equal(error.message.includes(A_KEY), false);
      return true;
    },
  );
});

test("with no key at all, or a malformed one, start-up fails naming the variable", () => {
  assert.throws(() => createPaymentRail(monadEnv({})), /needs MONAD_OPERATOR_PRIVATE_KEY/);
  assert.throws(() => createPaymentRail(monadEnv({ [OPERATOR_KEY_VAR]: "0x1234" })), /needs MONAD_OPERATOR_PRIVATE_KEY/);
  assert.throws(() => createPaymentRail({ PAYMENT_RAIL: "monad", [OPERATOR_KEY_VAR]: OPERATOR_KEY }), /MONAD_ESCROW_ADDRESS/);
});

test("when both variables are set the operator key is the one used", async () => {
  const rail = createPaymentRail(monadEnv({ [OPERATOR_KEY_VAR]: OPERATOR_KEY, [LEGACY_KEY_VAR]: A_KEY }));
  assert.ok(rail instanceof MonadRail);
  const check = await rail.checkOperator();
  assert.equal(check.account, privateKeyToAccount(OPERATOR_KEY).address);
});

test("a rail that cannot reach the chain reports not ready instead of throwing", async () => {
  const rail = createPaymentRail(monadEnv({ [OPERATOR_KEY_VAR]: OPERATOR_KEY }));
  assert.ok(rail instanceof MonadRail);
  const check = await rail.checkOperator();
  assert.equal(check.authorized, false);
  assert.equal(!check.authorized && check.reason, "upstream_unavailable");
});
