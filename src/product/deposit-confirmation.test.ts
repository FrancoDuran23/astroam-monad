// What a caller of the confirmation endpoints can and cannot do. The chain
// decides (here FakeRail, which keeps the contract's rules): a mission is only
// ever credited with a deposit made into its own escrow, and a transaction is
// credited once, also across a restart of the server.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MissionProductService } from "./services/MissionProductService.ts";
import { FileMissionRepository } from "./persistence/MissionRepository.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { FakeRail } from "../rails/FakeRail.ts";
import { escrowIdForMission } from "../shared/monad/voucher.ts";

const BRASIL = { id: "br", name: "Brasil", flag: "BR", network: "Vivo", coverage: "4G/5G", pricePerMbUsdc: 0.0025 };

let dataDir: string;
let provider: FakeProvider;
let rail: FakeRail;
let service: MissionProductService;

/** A server process: its own memory, the missions file it finds on disk, and the same chain. */
function boot(): MissionProductService {
  return new MissionProductService({ repo: new FileMissionRepository(dataDir), connectivity: provider, rail, logger: () => {} });
}

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = "true";
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.PRICE_PER_MB_RAW;
});

after(() => {
  delete process.env.ENABLE_DEMO_TRAFFIC;
});

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "astroam-confirm-"));
  provider = new FakeProvider();
  rail = new FakeRail();
  service = boot();
});

async function newMission(budgetUsdc = 10) {
  const created = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-05",
    endDate: "2026-10-12",
    budgetUsdc,
    dailyLimitUsdc: budgetUsdc,
  });
  const intent = await service.createPaymentIntent(created.id);
  return { id: created.id, intentId: intent.intentId, txHash: `0xdeposit_${created.id}` };
}

/** A paid and activated trip. */
async function openTrip(budgetUsdc = 10) {
  const mission = await newMission(budgetUsdc);
  await service.confirmPayment(mission.id, mission.intentId, mission.txHash);
  const activated = await service.activateMission(mission.id);
  return { ...mission, escrowId: escrowIdForMission(mission.id), iccid: activated.esim.iccid };
}

const walletFundings = (iccid: string) => provider.sim(iccid).fundingRequests.map((f) => f.amountCents);

// ---------------------------------------------------------------------------
// The mission deposit
// ---------------------------------------------------------------------------

test("a deposit is confirmed by a server that never saw the intent", async () => {
  const mission = await newMission(5);

  service = boot(); // restart between the intent and the confirmation
  const res = await service.confirmPayment(mission.id, mission.intentId, mission.txHash);

  assert.equal(res.status, "paid");
  const stored = await service.getMission(mission.id);
  assert.equal(stored.paymentStatus, "paid");
  assert.equal(stored.status, "paid");
  assert.equal(stored.channelId, escrowIdForMission(mission.id));
  assert.equal(stored.depositAtomic, "5000000");
  assert.equal(stored.depositVerified, true);
});

test("the intent id is a label: a wrong one does not stop a real deposit", async () => {
  const mission = await newMission(5);
  const res = await service.confirmPayment(mission.id, "an_intent_nobody_issued", mission.txHash);
  assert.equal(res.status, "paid");
});

test("a deposit made into another mission's escrow never pays for this one", async () => {
  const paid = await newMission(10);
  await service.confirmPayment(paid.id, paid.intentId, paid.txHash);
  const other = await newMission(10);

  // The other mission's caller offers the first mission's transaction, with its own intent or the payer's.
  for (const intentId of [other.intentId, paid.intentId]) {
    await assert.rejects(service.confirmPayment(other.id, intentId, paid.txHash), /not accepted: deposit_not_in_tx/);
  }

  let stored = await service.getMission(other.id);
  assert.notEqual(stored.paymentStatus, "paid");
  assert.equal(stored.channelId, undefined);
  assert.equal(stored.depositVerified, undefined);
  assert.equal(rail.escrow.read(escrowIdForMission(other.id)), undefined);
  await assert.rejects(service.activateMission(other.id), /only be activated after its deposit is confirmed/);

  // The rejected attempts do not block the mission's own deposit.
  await service.confirmPayment(other.id, other.intentId, other.txHash);
  stored = await service.getMission(other.id);
  assert.equal(stored.paymentStatus, "paid");
  assert.equal(stored.channelId, escrowIdForMission(other.id));
});

test("confirming a paid mission again changes nothing, whatever transaction is offered", async () => {
  const mission = await newMission(10);
  const other = await newMission(10);
  await service.confirmPayment(other.id, other.intentId, other.txHash);
  const first = await service.confirmPayment(mission.id, mission.intentId, mission.txHash);
  const paidAt = (await service.getMission(mission.id)).updatedAt;

  service = boot(); // and across a restart
  for (const txHash of [mission.txHash, mission.txHash.toUpperCase(), other.txHash, "0xnever_sent"]) {
    const again = await service.confirmPayment(mission.id, mission.intentId, txHash);
    assert.equal(again.depositTxHash, first.depositTxHash);
  }

  const stored = await service.getMission(mission.id);
  assert.equal(stored.budgetUsdc, 10);
  assert.equal(stored.balanceUsdc, 10);
  assert.equal(stored.depositAtomic, "10000000");
  assert.equal(stored.updatedAt, paidAt);
  assert.equal(await rail.getChannelDepositRaw(stored.channelId!), 100_000_000n);
});

test("the mission is credited what its escrow holds, not what the mission asked for", async () => {
  const mission = await newMission(10);
  // The wallet deposits 3 USDC into the mission's escrow, although the mission asked for 10.
  await rail.confirmDeposit({ missionId: mission.id, txHash: mission.txHash, purpose: "mission", amountUsdc: 3 });

  await service.confirmPayment(mission.id, mission.intentId, mission.txHash);

  const stored = await service.getMission(mission.id);
  assert.equal(stored.depositAtomic, "3000000");
  assert.equal(stored.budgetUsdc, 3);
  assert.equal(stored.balanceUsdc, 3);
});

test("a confirmation the chain cannot answer yet does not mark the mission failed; a reverted one does, and neither blocks the real deposit", async () => {
  const mission = await newMission(5);
  const confirmDeposit = rail.confirmDeposit.bind(rail);

  rail.confirmDeposit = async () => ({ valid: false, reason: "tx_not_found" });
  await assert.rejects(service.confirmPayment(mission.id, mission.intentId, mission.txHash), /tx_not_found/);
  assert.equal((await service.getMission(mission.id)).paymentStatus, "pending");

  rail.confirmDeposit = async () => ({ valid: false, reason: "tx_reverted" });
  await assert.rejects(service.confirmPayment(mission.id, mission.intentId, mission.txHash), /tx_reverted/);
  assert.equal((await service.getMission(mission.id)).paymentStatus, "failed");

  rail.confirmDeposit = confirmDeposit;
  await service.confirmPayment(mission.id, mission.intentId, mission.txHash);
  assert.equal((await service.getMission(mission.id)).paymentStatus, "paid");
});

// ---------------------------------------------------------------------------
// Top-ups
// ---------------------------------------------------------------------------

test("the same top-up transaction confirmed again after a restart credits once", async () => {
  const trip = await openTrip(10);
  const intent = await service.createTopUpIntent(trip.id, 5);
  const first = await service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_1");
  assert.equal(first.balanceUsdc, 15);
  const funded = walletFundings(trip.iccid);

  service = boot();
  const again = await service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_1");
  const otherCase = await service.confirmTopUpPayment(trip.id, intent.intentId, "0xTOPUP_1");

  assert.equal(again.txHash, "0xtopup_1");
  assert.equal(otherCase.txHash, "0xtopup_1");
  const stored = await service.getMission(trip.id);
  assert.equal(stored.budgetUsdc, 15);
  assert.equal(stored.balanceUsdc, 15);
  assert.equal(stored.depositAtomic, "15000000");
  assert.equal(stored.topups.filter((t) => t.status === "settled").length, 1);
  assert.deepEqual(walletFundings(trip.iccid), funded);
  assert.equal(await rail.getChannelDepositRaw(trip.escrowId), 150_000_000n);
});

test("a top-up transaction offered under a second intent, or a made-up one, is still credited once", async () => {
  const trip = await openTrip(10);
  const one = await service.createTopUpIntent(trip.id, 5);
  const two = await service.createTopUpIntent(trip.id, 5);
  await service.confirmTopUpPayment(trip.id, one.intentId, "0xtopup_1");
  const funded = walletFundings(trip.iccid);

  const second = await service.confirmTopUpPayment(trip.id, two.intentId, "0xtopup_1");
  const madeUp = await service.confirmTopUpPayment(trip.id, "an_intent_nobody_issued", "0xtopup_1");

  assert.equal(second.txHash, "0xtopup_1");
  assert.equal(madeUp.txHash, "0xtopup_1");
  const stored = await service.getMission(trip.id);
  assert.equal(stored.budgetUsdc, 15);
  assert.equal(stored.depositAtomic, "15000000");
  // The second intent is still waiting for a transaction of its own.
  assert.equal(stored.topups.find((t) => t.intentId === two.intentId)?.status, "pending");
  assert.equal(stored.topups.length, 2);
  assert.deepEqual(walletFundings(trip.iccid), funded);

  // And it gets one: a different transaction is a different top-up.
  await service.confirmTopUpPayment(trip.id, two.intentId, "0xtopup_2");
  assert.equal((await service.getMission(trip.id)).budgetUsdc, 20);
});

test("a top-up is credited what the transaction added, and raises what vouchers may authorize", async () => {
  const trip = await openTrip(10);
  const intent = await service.createTopUpIntent(trip.id, 5);
  // The wallet tops up 2 USDC although the intent asked for 5.
  await rail.confirmDeposit({ missionId: trip.id, txHash: "0xtopup_1", purpose: "topup", channelId: trip.escrowId, amountUsdc: 2 });

  const res = await service.confirmTopUpPayment(trip.id, intent.intentId, "0xtopup_1");

  assert.equal(res.balanceUsdc, 12);
  const stored = await service.getMission(trip.id);
  assert.equal(stored.budgetUsdc, 12);
  assert.equal(stored.depositAtomic, "12000000");
  assert.equal(stored.topups[0]?.amountUsdc, 2);
  assert.equal(walletFundings(trip.iccid).at(-1), 200);

  // 12 USDC is the most a voucher can authorize now: not the 10 of the deposit, not the 15 asked for.
  const voucher = async (atomic: bigint) => ({ cumulativeAtomic: atomic.toString(), signature: await rail.signVoucher(trip.escrowId, atomic) });
  await assert.rejects(service.submitVoucher(trip.id, await voucher(12_000_001n)), /more than the deposit/);
  assert.equal((await service.submitVoucher(trip.id, await voucher(12_000_000n))).accepted, true);
});

test("a top-up that reached the escrow without an intent is credited from the chain", async () => {
  const trip = await openTrip(10);
  await rail.confirmDeposit({ missionId: trip.id, txHash: "0xtopup_direct", purpose: "topup", channelId: trip.escrowId, amountUsdc: 4 });

  const res = await service.confirmTopUpPayment(trip.id, "an_intent_nobody_issued", "0xtopup_direct");

  assert.equal(res.balanceUsdc, 14);
  const stored = await service.getMission(trip.id);
  assert.equal(stored.topups.length, 1);
  assert.equal(stored.topups[0]?.status, "settled");
  assert.equal(stored.topups[0]?.amountUsdc, 4);
});

test("a top-up of another mission's escrow, or the deposit transaction itself, is not credited as a top-up", async () => {
  const trip = await openTrip(10);
  const other = await openTrip(10);
  const theirs = await service.createTopUpIntent(other.id, 5);
  await service.confirmTopUpPayment(other.id, theirs.intentId, "0xtopup_theirs");
  const mine = await service.createTopUpIntent(trip.id, 5);
  const funded = walletFundings(trip.iccid);

  for (const txHash of ["0xtopup_theirs", other.txHash, trip.txHash]) {
    await assert.rejects(service.confirmTopUpPayment(trip.id, mine.intentId, txHash), /not accepted: deposit_not_in_tx/);
  }

  const stored = await service.getMission(trip.id);
  assert.equal(stored.budgetUsdc, 10);
  assert.equal(stored.depositAtomic, "10000000");
  assert.equal(stored.topups[0]?.status, "pending");
  assert.deepEqual(walletFundings(trip.iccid), funded);
  assert.equal((await service.getMission(other.id)).budgetUsdc, 15);
});

test("a top-up is not credited once the channel is closed", async () => {
  const mission = await newMission(10);
  await service.confirmPayment(mission.id, mission.intentId, mission.txHash);
  const intent = await service.createTopUpIntent(mission.id, 5);
  await service.cancelMission(mission.id); // closes the channel and refunds the deposit

  await assert.rejects(service.confirmTopUpPayment(mission.id, intent.intentId, "0xtopup_late"), /not accepted: tx_reverted/);
  assert.equal((await service.getMission(mission.id)).budgetUsdc, 10);
});

test("a top-up needs a mission with a confirmed deposit", async () => {
  const mission = await newMission(10);
  await assert.rejects(service.confirmTopUpPayment(mission.id, "any", "0xtopup_1"), /no payment channel yet/);
});
