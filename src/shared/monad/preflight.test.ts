import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chainChecks,
  configChecks,
  deployBlockers,
  escrowConfigMismatches,
  failureCount,
  formatMon,
  providerChecks,
  type ChainFacts,
  type ConfigFacts,
  type ProviderFacts,
} from "./preflight.ts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const ONE_MON = 10n ** 18n;

const goodChain: ChainFacts = {
  rpcUrl: "http://rpc",
  chainId: 10143,
  expectedChainId: 10143,
  escrowAddress: C,
  escrowHasCode: true,
  escrow: { usdc: USDC, payee: A, operator: B },
  configuredUsdc: USDC,
  operatorKeyAddress: B,
  operatorBalanceWei: ONE_MON,
};

const levels = (facts: ChainFacts) => chainChecks(facts).map((r) => r.level);

test("chain: a correct setup has no failure and no warning", () => {
  assert.deepEqual(levels(goodChain), ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
});

test("chain: an unreachable RPC stops the chain checks with one failure", () => {
  const results = chainChecks({ ...goodChain, rpcError: "ECONNREFUSED" });
  assert.equal(results.length, 1);
  assert.equal(results[0].level, "fail");
  assert.match(results[0].fix ?? "", /MONAD_RPC_URL/);
});

test("chain: wrong chain id, missing code, wrong usdc fail", () => {
  assert.equal(failureCount(chainChecks({ ...goodChain, chainId: 1 })), 1);
  assert.equal(failureCount(chainChecks({ ...goodChain, escrowHasCode: false })), 1);
  assert.equal(failureCount(chainChecks({ ...goodChain, escrow: { usdc: A, payee: A, operator: B } })), 1);
  assert.equal(failureCount(chainChecks({ ...goodChain, escrowAddress: undefined })), 1);
});

test("chain: the key may be the payee but that is a warning", () => {
  const results = chainChecks({ ...goodChain, operatorKeyAddress: A });
  assert.equal(failureCount(results), 0);
  assert.equal(results.filter((r) => r.level === "warn").length, 1);
});

test("chain: a key that is neither operator nor payee fails and names the fix", () => {
  const results = chainChecks({ ...goodChain, operatorKeyAddress: C });
  assert.equal(failureCount(results), 1);
  assert.match(results.find((r) => r.level === "fail")?.fix ?? "", /setOperator/);
});

test("chain: a missing key and an empty operator wallet fail", () => {
  assert.equal(failureCount(chainChecks({ ...goodChain, operatorKeyAddress: undefined, operatorBalanceWei: undefined })), 1);
  assert.equal(failureCount(chainChecks({ ...goodChain, operatorBalanceWei: 0n })), 1);
});

test("escrow config mismatches compare addresses case-insensitively", () => {
  const actual = { usdc: USDC, payee: A, operator: B, timeoutSeconds: 100n };
  assert.deepEqual(escrowConfigMismatches({ usdc: USDC.toLowerCase(), payee: A, operator: B, timeoutSeconds: 100n }, actual), []);
  assert.equal(escrowConfigMismatches({ usdc: USDC, payee: B, operator: A }, actual).length, 2);
  assert.equal(escrowConfigMismatches({ usdc: USDC, payee: A, operator: B, timeoutSeconds: 5n }, actual).length, 1);
  assert.equal(escrowConfigMismatches({ usdc: USDC, payee: A, operator: B }, actual).length, 0);
});

test("deploy blockers: chain id, gas and a USDC that is not 6 decimals", () => {
  const good = { rpcChainId: 10143, expectedChainId: 10143, deployerBalanceWei: ONE_MON, usdcHasCode: true, usdcDecimals: 6 };
  assert.deepEqual(deployBlockers(good, "rpc", USDC, A), []);
  assert.equal(deployBlockers({ ...good, rpcChainId: 1 }, "rpc", USDC, A).length, 1);
  assert.equal(deployBlockers({ ...good, deployerBalanceWei: 0n }, "rpc", USDC, A).length, 1);
  assert.equal(deployBlockers({ ...good, usdcHasCode: false }, "rpc", USDC, A).length, 1);
  assert.equal(deployBlockers({ ...good, usdcDecimals: 18 }, "rpc", USDC, A).length, 1);
});

const goodProvider: ProviderFacts = {
  connectivityProvider: "citrus",
  apiKeySet: true,
  balance: { balanceUsd: 10 },
  requiredUsd: 4.25,
  webhookSecretSet: true,
};

test("provider: a funded citrus setup passes", () => {
  assert.equal(failureCount(providerChecks(goodProvider)), 0);
});

test("provider: each problem is one failure", () => {
  assert.equal(failureCount(providerChecks({ ...goodProvider, connectivityProvider: "fake" })), 1);
  assert.equal(failureCount(providerChecks({ ...goodProvider, balance: { balanceUsd: 4.24 } })), 1);
  assert.equal(failureCount(providerChecks({ ...goodProvider, balance: { error: "401", unauthorized: true } })), 1);
  assert.equal(failureCount(providerChecks({ ...goodProvider, webhookSecretSet: false })), 1);
  assert.equal(failureCount(providerChecks({ ...goodProvider, apiKeySet: false, balance: undefined })), 1);
});

test("provider: a balance exactly equal to the requirement passes", () => {
  assert.equal(failureCount(providerChecks({ ...goodProvider, balance: { balanceUsd: 4.25 } })), 0);
});

const goodConfig: ConfigFacts = {
  paymentRail: "monad",
  liveEnabled: "true",
  demoTraffic: "false",
  accessTokenSet: true,
  frontendOrigin: "https://app.example.com",
};

test("config: the live setup passes, the .env.example defaults do not", () => {
  assert.equal(failureCount(configChecks(goodConfig)), 0);
  const defaults = configChecks({ paymentRail: "fake", liveEnabled: "false", demoTraffic: "true", accessTokenSet: false, frontendOrigin: "http://localhost:5173" });
  assert.equal(failureCount(defaults), 4);
});

test("config: a wildcard or empty origin fails; demo traffic must be the literal false", () => {
  assert.equal(failureCount(configChecks({ ...goodConfig, frontendOrigin: "*" })), 1);
  assert.equal(failureCount(configChecks({ ...goodConfig, frontendOrigin: "http://a, *" })), 1);
  assert.equal(failureCount(configChecks({ ...goodConfig, frontendOrigin: "" })), 1);
  assert.equal(failureCount(configChecks({ ...goodConfig, demoTraffic: undefined })), 1);
});

test("formatMon prints four decimals", () => {
  assert.equal(formatMon(ONE_MON), "1.0000");
  assert.equal(formatMon(ONE_MON / 20n), "0.0500");
});
