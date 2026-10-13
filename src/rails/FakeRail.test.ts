import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EscrowRevert, FakeRail, usdcToRaw } from "./FakeRail.ts";
import { buildMessage1 } from "../meter/voucher-port.ts";
import { escrowIdForMission, voucherDomain, VOUCHER_TYPES } from "../shared/monad/voucher.ts";

/** The stand-in wallet deposits `amountUsdc` for `missionId`; each mission has its own transaction. */
async function openChannel(rail: FakeRail, amountUsdc = 5, missionId = "mis_1") {
  const intent = await rail.createDepositIntent({ missionId, amountUsdc, purpose: "mission" });
  const txHash = `0xdeposit_${missionId}`;
  const confirmed = await rail.confirmDeposit({ missionId, txHash, purpose: "mission", amountUsdc });
  assert.equal(confirmed.valid, true);
  return { intent, txHash, channelId: (confirmed as { channelId: string }).channelId };
}

function m1(channel: string, cumulativeBytes: number) {
  return buildMessage1({
    sessionId: "ses_1",
    channel,
    network: "demo:local",
    cumulativeBytes,
    pricePerMibRaw: 26_215n,
    meterReadingId: `mr_${cumulativeBytes}`,
    observedAt: new Date("2026-10-01T12:00:00Z"),
  });
}

/** A voucher for the fake contract signed by any key, not only the channel's session key. */
function signAs(rail: FakeRail, key: Hex, channelId: string, cumulativeAmount: bigint): Promise<Hex> {
  return privateKeyToAccount(key).signTypedData({
    domain: voucherDomain(rail.escrow.chainId, rail.escrow.address),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: { escrowId: channelId as Hex, cumulativeAmount },
  });
}

const reverts = (errorName: string) => (error: unknown) => error instanceof EscrowRevert && error.errorName === errorName;

// ---------------------------------------------------------------------------
// Deposits: the chain decides, not a remembered intent
// ---------------------------------------------------------------------------

test("a confirmed deposit opens the mission's own channel holding that deposit", async () => {
  const rail = new FakeRail();
  const { intent, channelId } = await openChannel(rail);
  assert.equal(intent.isMock, true);
  assert.match(intent.qr ?? "", /^data:image\/svg\+xml;base64,/);
  assert.equal(channelId, escrowIdForMission("mis_1"));
  assert.equal(await rail.getChannelDepositRaw(channelId), usdcToRaw(5));
});

test("a deposit is confirmed without the intent ever being created on this rail", async () => {
  const rail = new FakeRail();
  const confirmed = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xabc", purpose: "mission", amountUsdc: 3 });
  assert.equal(confirmed.valid && confirmed.depositRaw, usdcToRaw(3));
  assert.equal(confirmed.valid && confirmed.amountRaw, usdcToRaw(3));
});

test("a deposit is rejected for an empty tx hash, and an unseen transaction with no wallet behind it is not found", async () => {
  const rail = new FakeRail();
  const empty = await rail.confirmDeposit({ missionId: "mis_1", txHash: " ", purpose: "mission", amountUsdc: 1 });
  assert.deepEqual(empty, { valid: false, reason: "missing_tx_hash" });
  const unseen = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xabc", purpose: "mission" });
  assert.deepEqual(unseen, { valid: false, reason: "tx_not_found" });
});

test("the same transaction confirmed twice is one deposit, whatever the second request claims", async () => {
  const rail = new FakeRail();
  const { txHash, channelId } = await openChannel(rail, 5);
  const again = await rail.confirmDeposit({ missionId: "mis_1", txHash, purpose: "mission", amountUsdc: 500 });
  assert.equal(again.valid && again.depositRaw, usdcToRaw(5));
  assert.equal(again.valid && again.amountRaw, usdcToRaw(5));
  assert.equal(await rail.getChannelDepositRaw(channelId), usdcToRaw(5));
});

test("a transaction that paid into another mission's escrow is rejected", async () => {
  const rail = new FakeRail();
  const one = await openChannel(rail, 5, "mis_1");
  const other = await rail.confirmDeposit({ missionId: "mis_2", txHash: one.txHash, purpose: "mission", amountUsdc: 5 });
  assert.deepEqual(other, { valid: false, reason: "deposit_not_in_tx" });
  assert.equal(rail.escrow.read(escrowIdForMission("mis_2")), undefined);

  // Nor does a deposit pass for a top-up of the same mission.
  const asTopUp = await rail.confirmDeposit({ missionId: "mis_1", txHash: one.txHash, purpose: "topup", channelId: one.channelId, amountUsdc: 5 });
  assert.deepEqual(asTopUp, { valid: false, reason: "deposit_not_in_tx" });
  assert.equal(await rail.getChannelDepositRaw(one.channelId), usdcToRaw(5));
});

test("a second deposit into an escrow that exists is a reverted transaction", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const second = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xanother", purpose: "mission", amountUsdc: 5 });
  assert.deepEqual(second, { valid: false, reason: "tx_reverted" });
  assert.equal(await rail.getChannelDepositRaw(channelId), usdcToRaw(5));
  assert.throws(() => rail.escrow.deposit(channelId, 1n, rail.escrow.address, rail.escrow.address), reverts("EscrowExists"));
});

test("a top-up adds to the same channel once and reports what it added", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  await rail.createDepositIntent({ missionId: "mis_1", amountUsdc: 2, purpose: "topup", channelId });
  const first = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xdef", purpose: "topup", channelId, amountUsdc: 2 });
  assert.equal(first.valid && first.depositRaw, usdcToRaw(7));
  assert.equal(first.valid && first.amountRaw, usdcToRaw(2));

  const again = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xDEF", purpose: "topup", channelId, amountUsdc: 2 });
  assert.equal(again.valid && again.depositRaw, usdcToRaw(7));
  assert.equal(await rail.getChannelDepositRaw(channelId), usdcToRaw(7));
});

test("a top-up is only taken for the mission's own channel", async () => {
  const rail = new FakeRail();
  const one = await openChannel(rail, 5, "mis_1");
  const two = await openChannel(rail, 5, "mis_2");
  await assert.rejects(
    rail.createDepositIntent({ missionId: "mis_1", amountUsdc: 2, purpose: "topup", channelId: two.channelId }),
    /needs the mission's open channel/,
  );
  const res = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xdef", purpose: "topup", channelId: two.channelId, amountUsdc: 2 });
  assert.deepEqual(res, { valid: false, reason: "channel_mismatch" });
  assert.equal(await rail.getChannelDepositRaw(one.channelId), usdcToRaw(5));
  assert.equal(await rail.getChannelDepositRaw(two.channelId), usdcToRaw(5));
});

// ---------------------------------------------------------------------------
// What AstroAmEscrow rejects, the fake rejects
// ---------------------------------------------------------------------------

test("a voucher above the deposit is rejected", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const signature = await rail.signVoucher(channelId, 5_000_001n);

  assert.deepEqual(await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "5000001", signature }), {
    accepted: false,
    reason: "exceeds_deposit",
  });
  await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 5_000_001n, signature }), reverts("AmountExceedsDeposit"));
  await assert.rejects(rail.escrow.close(channelId, 5_000_001n, signature, 1n), reverts("AmountExceedsDeposit"));
  assert.equal(rail.getClaimedAtomic(channelId), 0n);

  // The whole deposit is the most a voucher can authorize.
  const whole = await rail.signVoucher(channelId, 5_000_000n);
  assert.deepEqual(await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "5000000", signature: whole }), {
    accepted: true,
    authorizedRaw: usdcToRaw(5),
  });
});

test("a voucher is verified against the channel's session key", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const other = await openChannel(rail, 5, "mis_2");
  const good = await rail.signVoucher(channelId, 2_000_000n);
  const stranger = await signAs(rail, generatePrivateKey(), channelId, 2_000_000n);
  const otherChannel = await rail.signVoucher(other.channelId, 2_000_000n);

  for (const signature of [stranger, otherChannel]) {
    assert.deepEqual(await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "2000000", signature }), {
      accepted: false,
      reason: "bad_signature",
    });
    await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 2_000_000n, signature }), reverts("BadVoucher"));
  }
  // A good signature does not cover a different amount.
  await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 3_000_000n, signature: good }), reverts("BadVoucher"));
  // Not a signature at all.
  const garbage = `0x${"ab".repeat(65)}`;
  await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 2_000_000n, signature: garbage }), reverts("BadVoucher"));
  assert.deepEqual(await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "2000000", signature: "0xmock_sig" }), {
    accepted: false,
    reason: "invalid_signature",
  });
  assert.equal(await rail.getAuthorizedRaw(channelId), 0n);
  assert.equal(rail.escrow.payeeBalance, 0n);

  assert.deepEqual(await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "2000000", signature: good }), {
    accepted: true,
    authorizedRaw: usdcToRaw(2),
  });
});

test("a claim pays the payee the part not collected yet, and a claim not above what was claimed is rejected", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const sig15 = await rail.signVoucher(channelId, 1_500_000n);
  const sig10 = await rail.signVoucher(channelId, 1_000_000n);
  const sig30 = await rail.signVoucher(channelId, 3_000_000n);

  const first = await rail.claim({ channelId, voucherAmountAtomic: 1_500_000n, signature: sig15 });
  assert.equal(first.claimedAtomic, 1_500_000n);
  assert.equal(rail.escrow.payeeBalance, 1_500_000n);

  // The same voucher again, and a lower one: nothing to claim.
  await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 1_500_000n, signature: sig15 }), reverts("NothingToClaim"));
  await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 1_000_000n, signature: sig10 }), reverts("NothingToClaim"));
  assert.equal(rail.getClaimedAtomic(channelId), 1_500_000n);
  assert.equal(rail.escrow.payeeBalance, 1_500_000n);

  const second = await rail.claim({ channelId, voucherAmountAtomic: 3_000_000n, signature: sig30 });
  assert.notEqual(second.txHash, first.txHash);
  assert.equal(rail.getClaimedAtomic(channelId), 3_000_000n);
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);

  await assert.rejects(rail.claim({ channelId: escrowIdForMission("nobody"), voucherAmountAtomic: 1n, signature: sig10 }), reverts("EscrowMissing"));
});

test("a settlement below what was already claimed is rejected", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const signature = await rail.signVoucher(channelId, 3_000_000n);
  await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "3000000", signature });
  await rail.claim({ channelId, voucherAmountAtomic: 3_000_000n, signature });

  await assert.rejects(rail.escrow.close(channelId, 3_000_000n, signature, 2_999_999n), reverts("SettleBelowClaimed"));
  for (const settleRaw of [usdcToRaw(2), 0n]) {
    const outcome = await rail.closeChannel(channelId, settleRaw);
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.kind === "failed" ? outcome.detail : "", /SettleBelowClaimed/);
  }
  assert.equal((await rail.readEscrowState(channelId))?.settled, false);

  // Settling exactly what was claimed pays nothing more and refunds the rest.
  const outcome = await rail.closeChannel(channelId, usdcToRaw(3));
  assert.equal(outcome.kind, "closed");
  assert.equal(rail.escrow.payeeBalance, 3_000_000n);
});

test("a settlement above the highest voucher is rejected by the contract, and the rail never asks for one", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const signature = await rail.signVoucher(channelId, 2_000_000n);
  await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "2000000", signature });

  await assert.rejects(rail.escrow.close(channelId, 2_000_000n, signature, 2_000_001n), reverts("SettleExceedsVoucher"));
  assert.equal((await rail.readEscrowState(channelId))?.settled, false);

  // Usage says 4 USDC, the traveler authorized 2: like MonadRail, the rail settles 2.
  const outcome = await rail.closeChannel(channelId, usdcToRaw(4));
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw, usdcToRaw(2));
  assert.equal(outcome.refundedRaw, usdcToRaw(3));
  assert.equal(rail.escrow.payeeBalance, 2_000_000n);
});

test("every operation on a settled channel is rejected", async () => {
  const rail = new FakeRail();
  const { txHash, channelId } = await openChannel(rail, 5);
  const signature = await rail.signVoucher(channelId, 2_000_000n);
  await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "2000000", signature });
  assert.equal((await rail.closeChannel(channelId, usdcToRaw(1))).kind, "closed");

  const higher = await rail.signVoucher(channelId, 3_000_000n);
  await assert.rejects(rail.claim({ channelId, voucherAmountAtomic: 3_000_000n, signature: higher }), reverts("AlreadySettled"));
  await assert.rejects(rail.escrow.close(channelId, 3_000_000n, higher, 3_000_000n), reverts("AlreadySettled"));
  const closeAgain = await rail.closeChannel(channelId, usdcToRaw(1));
  assert.equal(closeAgain.kind, "failed");
  assert.match(closeAgain.kind === "failed" ? closeAgain.detail : "", /already settled/);
  assert.deepEqual(await rail.submitTravelerVoucher({ channelId, cumulativeAmount: "3000000", signature: higher }), {
    accepted: false,
    reason: "channel_closed",
  });
  const reading = await rail.voucherPortFor(channelId).requestVoucher(m1(channelId, 1_000_000));
  assert.equal(reading.status, "unsigned");
  assert.equal(reading.status === "unsigned" && reading.reason, "channel_closing");

  // A top-up sent now reverts, and the deposit no longer confirms: the escrow holds nothing.
  const topUp = await rail.confirmDeposit({ missionId: "mis_1", txHash: "0xlate", purpose: "topup", channelId, amountUsdc: 2 });
  assert.deepEqual(topUp, { valid: false, reason: "tx_reverted" });
  const deposit = await rail.confirmDeposit({ missionId: "mis_1", txHash, purpose: "mission", amountUsdc: 5 });
  assert.deepEqual(deposit, { valid: false, reason: "channel_closed" });

  // Paid once, refunded once.
  assert.equal(rail.escrow.payeeBalance, 1_000_000n);
  assert.equal(rail.escrow.refunded.get(rail.escrow.read(channelId)!.traveler), 4_000_000n);
});

// ---------------------------------------------------------------------------
// The meter's vouchers and the close
// ---------------------------------------------------------------------------

test("the meter's vouchers are signed with the session key, cover the reading and stop at the deposit", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const port = rail.voucherPortFor(channelId);

  const first = await port.requestVoucher(m1(channelId, 300_000_000));
  assert.equal(first.status, "signed");
  if (first.status !== "signed") return;
  assert.ok(BigInt(first.voucher.cumulativeAmount) >= BigInt(m1(channelId, 300_000_000).cumulativeAmount));
  assert.equal(first.reused, false);
  assert.equal(first.voucher.commitmentPubkey, rail.escrow.read(channelId)!.signer);
  // The contract accepts it: it is a real voucher for this channel.
  const atomic = BigInt(first.voucher.cumulativeAmount) / 10n;
  await rail.claim({ channelId, voucherAmountAtomic: atomic, signature: first.voucher.signature });
  assert.equal(rail.getClaimedAtomic(channelId), atomic);

  const same = await port.requestVoucher(m1(channelId, 300_000_000));
  assert.equal(same.status === "signed" && same.reused, true);

  // 2,400 MB costs more than the 5 USDC deposit.
  const tooMuch = await port.requestVoucher(m1(channelId, 2_400_000_000));
  assert.equal(tooMuch.status, "unsigned");
  assert.equal(tooMuch.status === "unsigned" && tooMuch.reason, "channel_exhausted");
});

test("closing settles the highest signed voucher and refunds the rest", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail, 5);
  const port = rail.voucherPortFor(channelId);
  assert.equal((await port.requestVoucher(m1(channelId, 300_000_000))).status, "signed");
  assert.equal((await port.requestVoucher(m1(channelId, 1_000_000_000))).status, "signed");

  const outcome = await rail.closeChannel(channelId);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw + outcome.refundedRaw, usdcToRaw(5));
  assert.equal(outcome.settledRaw, await rail.getAuthorizedRaw(channelId));
  assert.ok(outcome.settledRaw > 0n);
  assert.equal(rail.escrow.payeeBalance * 10n, outcome.settledRaw);
  assert.equal((await rail.closeChannel(channelId)).kind, "failed");
});

test("closing a channel with no voucher refunds the whole deposit", async () => {
  const rail = new FakeRail();
  const { channelId } = await openChannel(rail);
  const outcome = await rail.closeChannel(channelId, 0n);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw, 0n);
  assert.equal(outcome.refundedRaw, usdcToRaw(5));
  assert.equal(rail.escrow.payeeBalance, 0n);
});

test("closing a channel that was never opened fails", async () => {
  const rail = new FakeRail();
  const outcome = await rail.closeChannel(escrowIdForMission("nobody"));
  assert.equal(outcome.kind === "failed" && outcome.reason, "channel_not_found");
});
