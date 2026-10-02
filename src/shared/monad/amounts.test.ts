import { test } from "node:test";
import assert from "node:assert/strict";
import { usageAtomic, usdcToMonadAtomic, usdcToStellarRaw } from "./amounts.ts";
import { MONAD_USDC_ADDRESS, MONAD_USDC_DECIMALS } from "./constants.ts";
import { monadTxUrl } from "./explorer.ts";
import { buildClosePlan, escrowIdForMission } from "./voucher.ts";

test("Circle USDC on Monad is 6 decimals, a tenth of the Stellar raw unit", () => {
  assert.equal(MONAD_USDC_DECIMALS, 6);
  assert.equal(MONAD_USDC_ADDRESS, "0x534b2f3A21130d7a60830c2Df862319e593943A3");
  assert.equal(usdcToMonadAtomic(5), 5_000_000n);
  assert.equal(usdcToStellarRaw(5), 50_000_000n);
  assert.equal(usdcToStellarRaw(5) / usdcToMonadAtomic(5), 10n);
});

test("Brasil usage is priced in 6-decimal atomic units and capped by the deposit", () => {
  const deposit = usdcToMonadAtomic(5);
  const used = usageAtomic({
    meteredBytes: 1_000_000_000n, // 1_000 MB
    pricePerMbUsdc: 0.0025,
    depositAtomic: deposit,
  });
  assert.equal(used, 2_500_000n); // 2.5 USDC

  // The Stellar meter prices 0.0025 USDC/MB as 25_000 raw (1e-7). Sending that
  // figure as a 6-decimal amount bills 0.025 USDC/MB — ten times the tariff —
  // and 1_000 MB would ask for 25 USDC against a 5 USDC deposit.
  const naiveSevenDecimalCharge = (1_000_000_000n * 25_000n) / 1_000_000n;
  assert.equal(naiveSevenDecimalCharge, 25_000_000n);
  assert.ok(naiveSevenDecimalCharge > deposit);

  const capped = usageAtomic({
    meteredBytes: 3_000_000_000n, // 3_000 MB would be 7.5 USDC
    pricePerMbUsdc: 0.0025,
    depositAtomic: deposit,
  });
  assert.equal(capped, deposit);
});

test("close plan quotes one cumulative voucher, not a per-MB debit", () => {
  const plan = buildClosePlan({
    missionId: "mis_demo",
    budgetUsdc: 5,
    meteredBytes: 400_000_000n, // 400 MB
    pricePerMbUsdc: 0.0025,
    env: {},
  });
  assert.equal(plan.cumulativeAmount, "1000000"); // 1 USDC
  assert.equal(plan.refundAtomic, "4000000");
  assert.equal(plan.amount, "5000000");
  assert.equal(plan.deployed, false);
  assert.equal(plan.typedData, null);
  assert.equal(plan.chainId, 10143);
  assert.equal(escrowIdForMission("mis_demo"), plan.escrowId);
  assert.equal(escrowIdForMission("mis_demo"), escrowIdForMission("mis_demo"));
  assert.notEqual(escrowIdForMission("mis_demo"), escrowIdForMission("mis_other"));
});

test("typed data is bound to the configured escrow and chain 10143", () => {
  const escrow = "0x1111111111111111111111111111111111111111";
  const plan = buildClosePlan({
    missionId: "mis_demo",
    budgetUsdc: 5,
    meteredBytes: 0n,
    pricePerMbUsdc: 0.0025,
    env: { MONAD_ESCROW_ADDRESS: escrow },
  });
  assert.equal(plan.deployed, true);
  assert.equal(plan.typedData?.domain.name, "AstroAmEscrow");
  assert.equal(plan.typedData?.domain.version, "1");
  assert.equal(plan.typedData?.domain.chainId, 10143);
  assert.equal(plan.typedData?.domain.verifyingContract, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.typedData?.message.cumulativeAmount, "0");
  assert.equal(plan.typedData?.primaryType, "CloseVoucher");
});

test("MonadVision links only real transaction hashes", () => {
  assert.equal(
    monadTxUrl("0x" + "ab".repeat(32)),
    "https://testnet.monadvision.com/tx/" + "0x" + "ab".repeat(32),
  );
  assert.equal(monadTxUrl("demo_tx_hash"), null);
  assert.equal(monadTxUrl("close_tx_1"), null);
});
