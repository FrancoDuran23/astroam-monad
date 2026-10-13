// End to end against a local chain (anvil): deploy escrow v4 with the traveler,
// the operator and the payee as three different accounts, deposit with a
// session key, verify the deposit, sign vouchers in the "app", meter against
// them, claim and close. Skipped when Foundry is not installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MonadRail } from "./MonadRail.ts";
import { astroAmEscrowAbi, erc20Abi } from "../shared/monad/abi.ts";
import { escrowIdForMission, voucherDomain, VOUCHER_TYPES } from "../shared/monad/voucher.ts";
import { buildMessage1 } from "../meter/voucher-port.ts";
import { MissionProductService } from "../product/services/MissionProductService.ts";
import { FileMissionRepository } from "../product/persistence/MissionRepository.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { createServerApp } from "../server/app.ts";

const HOME = os.homedir();
const FOUNDRY_DIRS = [path.join(HOME, ".config", ".foundry", "bin"), path.join(HOME, ".foundry", "bin")];
function foundryBin(name: string): string | undefined {
  for (const dir of [...(process.env.PATH ?? "").split(":"), ...FOUNDRY_DIRS]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
const anvilBin = foundryBin("anvil");
const forgeBin = foundryBin("forge");
const skip = !anvilBin || !forgeBin ? "Foundry (anvil + forge) is not installed" : false;

// anvil's well-known dev accounts 0 to 3. Nobody shares a key: the deployer
// only deploys and mints, and the operator is never sent any USDC.
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const TRAVELER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const OPERATOR_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const PAYEE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// anvil mines on arrival, so receipts are polled fast.
const POLL_MS = 50;
const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: POLL_MS });
const deployer = privateKeyToAccount(DEPLOYER_KEY);
const traveler = privateKeyToAccount(TRAVELER_KEY);
const operator = privateKeyToAccount(OPERATOR_KEY);
const payee = privateKeyToAccount(PAYEE_KEY);
const deployerWallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });
const travelerWallet = createWalletClient({ account: traveler, chain, transport: http(RPC) });
const TIMEOUT_SECONDS = 30n * 24n * 3600n;
const MISSION_DATES = { startDate: "2026-10-05", endDate: "2026-10-12" };
const BRASIL = { id: "br", name: "Brasil", flag: "BR", network: "Vivo", coverage: "4G/5G", pricePerMbUsdc: 0.0025 };

let anvil: ChildProcess | undefined;
let usdc: Address;
let escrow: Address;

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(fs.readFileSync(path.join("contracts", "out", file, `${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function deploy(art: { abi: Abi; bytecode: Hex }, args: unknown[]): Promise<Address> {
  const hash = await deployerWallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

async function balance(who: Address): Promise<bigint> {
  return client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "monad-rail-"));
}

/** A rail as the server builds it. A new instance over the same chain is a restart. */
function makeRail(options: { key?: Hex; dataDir?: string; contract?: Address; receiptTimeoutMs?: number } = {}): MonadRail {
  return new MonadRail({
    rpcUrl: RPC,
    chainId: 31337,
    explorer: "https://explorer.test",
    network: "monad:testnet",
    escrow: options.contract ?? escrow,
    usdc,
    operatorPrivateKey: options.key ?? OPERATOR_KEY,
    dataDir: options.dataDir ?? tempDir(),
    pollingIntervalMs: POLL_MS,
    ...(options.receiptTimeoutMs !== undefined ? { receiptTimeoutMs: options.receiptTimeoutMs } : {}),
  });
}

/** The traveler's wallet: approve and `deposit` into `contract`, registering a fresh session key. */
async function walletDeposit(escrowId: Hex, amount: bigint, contract: Address = escrow): Promise<{ tx: Hex; sessionKey: Hex }> {
  const sessionKey = generatePrivateKey();
  const approve = await travelerWallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [contract, amount] });
  await client.waitForTransactionReceipt({ hash: approve });
  const tx = await travelerWallet.writeContract({
    address: contract,
    abi: astroAmEscrowAbi,
    functionName: "deposit",
    args: [escrowId, amount, privateKeyToAccount(sessionKey).address],
  });
  await client.waitForTransactionReceipt({ hash: tx });
  return { tx, sessionKey };
}

/** The traveler's wallet: approve and `topUp`. */
async function walletTopUp(escrowId: Hex, amount: bigint): Promise<Hex> {
  const approve = await travelerWallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [escrow, amount] });
  await client.waitForTransactionReceipt({ hash: approve });
  const tx = await travelerWallet.writeContract({ address: escrow, abi: astroAmEscrowAbi, functionName: "topUp", args: [escrowId, amount] });
  await client.waitForTransactionReceipt({ hash: tx });
  return tx;
}

/** The traveler's app: an EIP-712 voucher for a running total, signed with `key`. */
function signVoucher(key: Hex, escrowId: Hex, cumulativeAmount: bigint): Promise<Hex> {
  return privateKeyToAccount(key).signTypedData({
    domain: voucherDomain(31337, escrow),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: { escrowId, cumulativeAmount },
  });
}

async function onChainDeposit(escrowId: Hex): Promise<bigint> {
  const fields = await client.readContract({ address: escrow, abi: astroAmEscrowAbi, functionName: "escrows", args: [escrowId] });
  return fields[4];
}

before(async () => {
  if (skip) return;
  const build = spawnSync(forgeBin!, ["build", "--root", "contracts"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  anvil = spawn(anvilBin!, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const mock = artifact("AstroAmEscrow.t.sol", "MockUsdc");
  usdc = await deploy(mock, [6]);
  const mint = await deployerWallet.writeContract({ address: usdc, abi: mock.abi, functionName: "mint", args: [traveler.address, 1_000_000_000n] });
  await client.waitForTransactionReceipt({ hash: mint });
  escrow = await deploy(artifact("AstroAmEscrow.sol", "AstroAmEscrow"), [usdc, payee.address, operator.address, TIMEOUT_SECONDS]);
});

after(() => {
  anvil?.kill();
});

test("deposit → app-signed vouchers → metering → close pays usage and refunds the rest", { skip }, async () => {
  const rail = makeRail();

  // 1. Deposit 5 USDC from the traveler's wallet, registering the app's session key.
  const intent = await rail.createDepositIntent({ missionId: "mis_anvil", amountUsdc: 5, purpose: "mission" });
  assert.ok(intent.evm);
  const escrowId = intent.evm.escrowId as Hex;
  assert.equal(escrowId, escrowIdForMission("mis_anvil"));
  const amount = BigInt(intent.evm.amountAtomic);
  assert.equal(amount, 5_000_000n);
  const { tx: depositTx, sessionKey } = await walletDeposit(escrowId, amount);

  const confirmed = await rail.confirmDeposit({ missionId: "mis_anvil", txHash: depositTx, purpose: "mission" });
  assert.equal(confirmed.valid, true);
  if (!confirmed.valid) return;
  assert.equal(confirmed.channelId, escrowId);
  assert.equal(confirmed.depositRaw, 50_000_000n);
  assert.equal(confirmed.amountRaw, 50_000_000n);
  assert.equal(confirmed.travelerAddress, traveler.address);
  assert.equal(confirmed.sessionKey, privateKeyToAccount(sessionKey).address);
  assert.equal(confirmed.explorerUrl, `https://explorer.test/tx/${depositTx}`);

  // The same transaction verifies again as the same deposit: the total does not move.
  const again = await rail.confirmDeposit({ missionId: "mis_anvil", txHash: depositTx, purpose: "mission" });
  assert.equal(again.valid && again.depositRaw, 50_000_000n);
  assert.equal(await onChainDeposit(escrowId), 5_000_000n);

  // 2. The app signs a voucher authorizing 2 USDC ahead.
  const accepted = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "2000000", signature: await signVoucher(sessionKey, escrowId, 2_000_000n) });
  assert.deepEqual(accepted, { accepted: true, authorizedRaw: 20_000_000n });

  const stranger = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "3000000", signature: await signVoucher(generatePrivateKey(), escrowId, 3_000_000n) });
  assert.deepEqual(stranger, { accepted: false, reason: "bad_signature" });
  const tooMuch = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "6000000", signature: await signVoucher(sessionKey, escrowId, 6_000_000n) });
  assert.deepEqual(tooMuch, { accepted: false, reason: "exceeds_deposit" });

  // 3. Metering: 300 MB is covered by the 2 USDC voucher; 1000 MB is not yet.
  const port = rail.voucherPortFor(escrowId);
  const reading = (mb: number) =>
    buildMessage1({
      sessionId: "ses_anvil",
      channel: escrowId,
      network: "monad:testnet",
      cumulativeBytes: mb * 1_000_000,
      pricePerMibRaw: 26_215n,
      meterReadingId: `mr_${mb}`,
      observedAt: new Date(),
    });
  const covered = await port.requestVoucher(reading(300));
  assert.equal(covered.status, "signed");
  if (covered.status === "signed") assert.equal(covered.voucher.cumulativeAmount, "20000000");
  const notYet = await port.requestVoucher(reading(1000));
  assert.equal(notYet.status, "unsigned");
  if (notYet.status === "unsigned") assert.equal(notYet.reason, "authorization_required");

  // 4. Close: 1.875 USDC used goes to the payee, 3.125 USDC back to the traveler.
  const before = { traveler: await balance(traveler.address), payee: await balance(payee.address), operator: await balance(operator.address), escrow: await balance(escrow) };
  const outcome = await rail.closeChannel(escrowId, 18_750_000n);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw, 18_750_000n);
  assert.equal(outcome.refundedRaw, 31_250_000n);
  assert.equal((await balance(payee.address)) - before.payee, 1_875_000n);
  assert.equal((await balance(traveler.address)) - before.traveler, 3_125_000n);
  assert.equal(before.escrow - (await balance(escrow)), 5_000_000n);
  assert.equal((await balance(operator.address)) - before.operator, 0n);

  // Settled once: a second close fails, a voucher after close is refused.
  assert.equal((await rail.closeChannel(escrowId, 1n)).kind, "failed");
  const late = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "4000000", signature: await signVoucher(sessionKey, escrowId, 4_000_000n) });
  assert.deepEqual(late, { accepted: false, reason: "channel_closed" });
  // The deposit no longer confirms either: the escrow holds nothing to credit.
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_anvil", txHash: depositTx, purpose: "mission" }), { valid: false, reason: "channel_closed" });
});

test("never settles more than the traveler authorized", { skip }, async () => {
  const rail = makeRail();
  const escrowId = escrowIdForMission("mis_cap");
  const { tx, sessionKey } = await walletDeposit(escrowId, 2_000_000n);
  assert.equal((await rail.confirmDeposit({ missionId: "mis_cap", txHash: tx, purpose: "mission" })).valid, true);

  await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "500000", signature: await signVoucher(sessionKey, escrowId, 500_000n) });

  // Usage says 1.2 USDC, but only 0.5 USDC was authorized: 0.5 is settled.
  const outcome = await rail.closeChannel(escrowId, 12_000_000n);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind === "closed") {
    assert.equal(outcome.settledRaw, 5_000_000n);
    assert.equal(outcome.refundedRaw, 15_000_000n);
  }
});

test("claim and close pay the payee exactly what was claimed and settled, and the operator never holds USDC", { skip }, async () => {
  const rail = makeRail();
  const escrowId = escrowIdForMission("mis_claim");
  const { tx, sessionKey } = await walletDeposit(escrowId, 5_000_000n);
  assert.equal((await rail.confirmDeposit({ missionId: "mis_claim", txHash: tx, purpose: "mission" })).valid, true);

  const start = { payee: await balance(payee.address), operator: await balance(operator.address), traveler: await balance(traveler.address) };

  // 1. The app signs a voucher for 2.5 USDC and the operator claims it.
  const sig1 = await signVoucher(sessionKey, escrowId, 2_500_000n);
  await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "2500000", signature: sig1 });
  const claimRes = await rail.claim({ channelId: escrowId, voucherAmountAtomic: 2_500_000n, signature: sig1, claimTotalAtomic: 2_500_000n });
  assert.ok(claimRes.txHash);
  assert.equal(claimRes.claimedAtomic, 2_500_000n);
  assert.equal((await balance(payee.address)) - start.payee, 2_500_000n);
  assert.equal((await balance(operator.address)) - start.operator, 0n);

  const state = await rail.readEscrowState(escrowId);
  assert.equal(state?.claimedAtomic, 2_500_000n);
  assert.equal(state?.settled, false);

  // The same voucher has nothing left to claim, and the payee is not paid again.
  await assert.rejects(rail.claim({ channelId: escrowId, voucherAmountAtomic: 2_500_000n, signature: sig1, claimTotalAtomic: 2_500_000n }), /NothingToClaim/);
  assert.equal((await balance(payee.address)) - start.payee, 2_500_000n);

  // 2. The app signs the next voucher for 4.0 USDC and the close settles it.
  const sig2 = await signVoucher(sessionKey, escrowId, 4_000_000n);
  await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "4000000", signature: sig2 });

  // A settlement below what was already claimed reverts and moves nothing.
  const tooLow = await rail.closeChannel(escrowId, 20_000_000n);
  assert.equal(tooLow.kind, "failed");
  assert.match(tooLow.kind === "failed" ? tooLow.detail : "", /SettleBelowClaimed/);
  assert.equal((await balance(payee.address)) - start.payee, 2_500_000n);

  const closeOutcome = await rail.closeChannel(escrowId, 40_000_000n);
  assert.equal(closeOutcome.kind, "closed");
  if (closeOutcome.kind === "closed") {
    assert.equal(closeOutcome.settledRaw, 40_000_000n);
    assert.equal(closeOutcome.refundedRaw, 10_000_000n);
  }

  // 3. The payee received what was claimed plus what the close added: 4 USDC in
  // all. The traveler got the other 1 USDC back. The operator sent both
  // transactions and its USDC balance is still zero.
  assert.equal((await balance(payee.address)) - start.payee, 4_000_000n);
  assert.equal((await balance(traveler.address)) - start.traveler, 1_000_000n);
  assert.equal((await balance(operator.address)) - start.operator, 0n);
  assert.equal(await balance(operator.address), 0n);
});

test("a claim collects the usage, not the voucher: 4 USDC signed, 1 USDC used, then a close at 1.5 USDC", { skip }, async () => {
  const rail = makeRail();
  const escrowId = escrowIdForMission("mis_ahead");
  const { tx, sessionKey } = await walletDeposit(escrowId, 5_000_000n);
  assert.equal((await rail.confirmDeposit({ missionId: "mis_ahead", txHash: tx, purpose: "mission" })).valid, true);

  // The app signs 4 USDC ahead of usage.
  const signature = await signVoucher(sessionKey, escrowId, 4_000_000n);
  await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "4000000", signature });
  const start = { payee: await balance(payee.address), traveler: await balance(traveler.address), escrow: await balance(escrow) };
  const claim = (claimTotalAtomic: bigint) => rail.claim({ channelId: escrowId, voucherAmountAtomic: 4_000_000n, signature, claimTotalAtomic });

  // 1 USDC was used: the claim collects 1, and the payee's balance grows by exactly 1.
  const claimed = await claim(1_000_000n);
  assert.equal(claimed.claimedAtomic, 1_000_000n);
  assert.equal((await balance(payee.address)) - start.payee, 1_000_000n);
  assert.equal((await rail.readEscrowState(escrowId))?.claimedAtomic, 1_000_000n);
  assert.equal(start.escrow - (await balance(escrow)), 1_000_000n);

  // The contract holds the claim to the voucher and makes it move forward.
  await assert.rejects(claim(4_000_001n), /ClaimExceedsVoucher/);
  await assert.rejects(claim(1_000_000n), /NothingToClaim/);
  assert.equal((await balance(payee.address)) - start.payee, 1_000_000n);

  // The trip ends at 1.5 USDC of usage: the close pays 0.5 more and refunds the rest.
  const outcome = await rail.closeChannel(escrowId, 15_000_000n);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw, 15_000_000n);
  assert.equal(outcome.refundedRaw, 35_000_000n);
  assert.equal((await balance(payee.address)) - start.payee, 1_500_000n);
  assert.equal((await balance(traveler.address)) - start.traveler, 3_500_000n);
  assert.equal(start.escrow - (await balance(escrow)), 5_000_000n);
});

test("a deposit is confirmed by a rail built after the intent was created (a restart in between)", { skip }, async () => {
  const beforeRestart = makeRail();
  const intent = await beforeRestart.createDepositIntent({ missionId: "mis_restart", amountUsdc: 3, purpose: "mission" });
  const escrowId = intent.evm!.escrowId as Hex;
  const { tx, sessionKey } = await walletDeposit(escrowId, BigInt(intent.evm!.amountAtomic));

  // A new process on a host without a disk: a new rail and an empty data directory.
  const afterRestart = makeRail();
  const confirmed = await afterRestart.confirmDeposit({ missionId: "mis_restart", txHash: tx, purpose: "mission" });
  assert.equal(confirmed.valid, true);
  if (!confirmed.valid) return;
  assert.equal(confirmed.channelId, escrowId);
  assert.equal(confirmed.depositRaw, 30_000_000n);
  assert.equal(confirmed.amountRaw, 30_000_000n);
  assert.equal(confirmed.sessionKey, privateKeyToAccount(sessionKey).address);

  // The intent ids are labels that a restart never reissues.
  const again = await afterRestart.createDepositIntent({ missionId: "mis_restart", amountUsdc: 3, purpose: "mission" });
  assert.notEqual(again.intentId, intent.intentId);
});

test("the amount credited is the one on chain, not the one the intent asked for", { skip }, async () => {
  const rail = makeRail();
  const intent = await rail.createDepositIntent({ missionId: "mis_amount", amountUsdc: 5, purpose: "mission" });
  const escrowId = intent.evm!.escrowId as Hex;
  // The wallet deposits 3 USDC although the intent asked for 5.
  const { tx } = await walletDeposit(escrowId, 3_000_000n);
  const confirmed = await rail.confirmDeposit({ missionId: "mis_amount", txHash: tx, purpose: "mission", amountUsdc: 5 });
  assert.equal(confirmed.valid && confirmed.depositRaw, 30_000_000n);
  assert.equal(confirmed.valid && confirmed.amountRaw, 30_000_000n);
});

test("the same top-up transaction confirmed twice credits once, with a new rail in between", { skip }, async () => {
  const dataDir = tempDir();
  const first = makeRail({ dataDir });
  const escrowId = escrowIdForMission("mis_topup");
  const { tx: depositTx } = await walletDeposit(escrowId, 5_000_000n);
  assert.equal((await first.confirmDeposit({ missionId: "mis_topup", txHash: depositTx, purpose: "mission" })).valid, true);

  await first.createDepositIntent({ missionId: "mis_topup", amountUsdc: 2, purpose: "topup", channelId: escrowId });
  const topUpTx = await walletTopUp(escrowId, 2_000_000n);
  const once = await first.confirmDeposit({ missionId: "mis_topup", txHash: topUpTx, purpose: "topup", channelId: escrowId });
  assert.equal(once.valid && once.depositRaw, 70_000_000n);
  assert.equal(once.valid && once.amountRaw, 20_000_000n);

  // Restart. The credit is the escrow's total, so the second answer is the same 7 USDC, not 9.
  const second = makeRail({ dataDir });
  const twice = await second.confirmDeposit({ missionId: "mis_topup", txHash: topUpTx, purpose: "topup", channelId: escrowId });
  assert.equal(twice.valid && twice.depositRaw, 70_000_000n);
  assert.equal(twice.valid && twice.amountRaw, 20_000_000n);
  assert.equal(await second.getChannelDepositRaw(escrowId), 70_000_000n);
  assert.equal(await onChainDeposit(escrowId), 7_000_000n);

  // A deposit is not a top-up and a top-up is not a deposit.
  assert.deepEqual(await second.confirmDeposit({ missionId: "mis_topup", txHash: depositTx, purpose: "topup", channelId: escrowId }), { valid: false, reason: "deposit_not_in_tx" });
  assert.deepEqual(await second.confirmDeposit({ missionId: "mis_topup", txHash: topUpTx, purpose: "mission" }), { valid: false, reason: "deposit_not_in_tx" });
});

test("through the product service: a restart between intent and confirmation still pays the mission, and replays credit once", { skip }, async () => {
  const dataDir = tempDir();
  const provider = new FakeProvider();
  // Everything the server keeps in memory is rebuilt; missions.json and the chain are what is left.
  const boot = () =>
    new MissionProductService({ repo: new FileMissionRepository(dataDir), connectivity: provider, rail: makeRail({ dataDir }), logger: () => {} });

  let service = boot();
  const { id } = await service.createMission({ destination: BRASIL, ...MISSION_DATES, budgetUsdc: 5, dailyLimitUsdc: 5 });
  const intent = await service.createPaymentIntent(id);
  const escrowId = intent.evm!.escrowId as Hex;
  assert.equal(escrowId, escrowIdForMission(id));
  const { tx: depositTx } = await walletDeposit(escrowId, BigInt(intent.evm!.amountAtomic));

  service = boot(); // the server restarts while the traveler's transaction is being mined
  const paid = await service.confirmPayment(id, intent.intentId, depositTx);
  assert.equal(paid.status, "paid");
  let mission = await service.getMission(id);
  assert.equal(mission.paymentStatus, "paid");
  assert.equal(mission.depositVerified, true);
  assert.equal(mission.depositAtomic, "5000000");
  assert.equal(mission.travelerAddress, traveler.address);

  const activated = await service.activateMission(id);
  const fundings = () => provider.sim(activated.esim.iccid).fundingRequests.length;

  // A top-up, confirmed; then the server restarts and the same transaction
  // is confirmed again, once under its own intent and once under another label.
  const top = await service.createTopUpIntent(id, 2);
  const topUpTx = await walletTopUp(escrowId, 2_000_000n);
  const first = await service.confirmTopUpPayment(id, top.intentId, topUpTx);
  assert.equal(first.balanceUsdc, 7);
  const fundedOnce = fundings();

  service = boot();
  const replay = await service.confirmTopUpPayment(id, top.intentId, topUpTx);
  const relabelled = await service.confirmTopUpPayment(id, "some_other_intent", topUpTx.toUpperCase().replace("0X", "0x"));
  assert.equal(replay.txHash, topUpTx);
  assert.equal(relabelled.txHash, topUpTx);
  await service.confirmPayment(id, intent.intentId, depositTx);

  mission = await service.getMission(id);
  assert.equal(mission.budgetUsdc, 7);
  assert.equal(mission.balanceUsdc, 7);
  assert.equal(mission.depositAtomic, "7000000");
  assert.equal(mission.topups.filter((t) => t.status === "settled").length, 1);
  assert.equal(mission.topups.length, 1);
  assert.equal(fundings(), fundedOnce);
  assert.equal(await onChainDeposit(escrowId), 7_000_000n);
});

test("a deposit into another mission's escrow, into another contract, or reverted is rejected", { skip }, async () => {
  const rail = makeRail({ receiptTimeoutMs: 1_000 });
  const mine = escrowIdForMission("mis_mine");
  const theirs = escrowIdForMission("mis_theirs");
  const { tx: theirTx } = await walletDeposit(theirs, 4_000_000n);

  // Another mission's deposit: the transaction is real, but it paid a different escrow.
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_mine", txHash: theirTx, purpose: "mission" }), { valid: false, reason: "deposit_not_in_tx" });
  // Passing the other mission's channel for a top-up does not help.
  const theirTopUp = await walletTopUp(theirs, 1_000_000n);
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_mine", txHash: theirTopUp, purpose: "topup", channelId: theirs }), { valid: false, reason: "channel_mismatch" });
  await assert.rejects(rail.createDepositIntent({ missionId: "mis_mine", amountUsdc: 1, purpose: "topup", channelId: theirs }), /needs the mission's open channel/);

  // Another contract: the same escrow id and the same event, emitted by a different AstroAmEscrow.
  const otherContract = await deploy(artifact("AstroAmEscrow.sol", "AstroAmEscrow"), [usdc, payee.address, operator.address, TIMEOUT_SECONDS]);
  const { tx: elsewhere } = await walletDeposit(mine, 4_000_000n, otherContract);
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_mine", txHash: elsewhere, purpose: "mission" }), { valid: false, reason: "deposit_not_in_tx" });
  assert.equal(await onChainDeposit(mine), 0n);

  // Reverted: a second deposit into an escrow that exists (gas is set, so the wallet sends it anyway).
  const approve = await travelerWallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [escrow, 4_000_000n] });
  await client.waitForTransactionReceipt({ hash: approve });
  const reverted = await travelerWallet.writeContract({ address: escrow, abi: astroAmEscrowAbi, functionName: "deposit", args: [theirs, 4_000_000n, traveler.address], gas: 300_000n });
  assert.equal((await client.waitForTransactionReceipt({ hash: reverted })).status, "reverted");
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_theirs", txHash: reverted, purpose: "mission" }), { valid: false, reason: "tx_reverted" });

  // Not a hash, and a hash the chain does not know.
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_mine", txHash: "0x1234", purpose: "mission" }), { valid: false, reason: "invalid_tx_hash" });
  assert.deepEqual(await rail.confirmDeposit({ missionId: "mis_mine", txHash: `0x${"12".repeat(32)}`, purpose: "mission" }), { valid: false, reason: "tx_not_found" });
});

test("a rail whose key is neither the operator nor the payee reports not ready and cannot collect", { skip }, async () => {
  const asOperator = await makeRail().checkOperator();
  assert.deepEqual(asOperator, { authorized: true, account: operator.address, operator: operator.address, payee: payee.address });
  // The contract accepts the payee too.
  assert.equal((await makeRail({ key: PAYEE_KEY }).checkOperator()).authorized, true);

  const strangerKey = generatePrivateKey();
  const strangerRail = makeRail({ key: strangerKey });
  const check = await strangerRail.checkOperator();
  assert.equal(check.authorized, false);
  if (check.authorized) return;
  assert.equal(check.reason, "operator_not_authorized");
  assert.equal(check.account, privateKeyToAccount(strangerKey).address);
  assert.match(check.detail, /MONAD_OPERATOR_PRIVATE_KEY/);
  // The traveler's own key is no better: only the operator and the payee collect.
  assert.equal((await makeRail({ key: TRAVELER_KEY }).checkOperator()).authorized, false);

  // What "not ready" stands for: the contract turns its claim and its close down.
  const escrowId = escrowIdForMission("mis_stranger");
  const { tx, sessionKey } = await walletDeposit(escrowId, 2_000_000n);
  assert.equal((await strangerRail.confirmDeposit({ missionId: "mis_stranger", txHash: tx, purpose: "mission" })).valid, true);
  const signature = await signVoucher(sessionKey, escrowId, 1_000_000n);
  await strangerRail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "1000000", signature });
  const payeeBefore = await balance(payee.address);
  await assert.rejects(strangerRail.claim({ channelId: escrowId, voucherAmountAtomic: 1_000_000n, signature, claimTotalAtomic: 1_000_000n }), /NotOperator/);
  const close = await strangerRail.closeChannel(escrowId, 10_000_000n);
  assert.equal(close.kind, "failed");
  assert.match(close.kind === "failed" ? close.detail : "", /NotOperator/);
  assert.equal((await balance(payee.address)) - payeeBefore, 0n);

  // /ready answers 503 for that server and 200 for one holding the operator key.
  const ready = async (rail: MonadRail) => {
    const service = new MissionProductService({ repo: new FileMissionRepository(tempDir()), connectivity: new FakeProvider(), rail, logger: () => {} });
    const server = createServerApp({ productService: service }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ready`);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
  const notReady = await ready(strangerRail);
  assert.equal(notReady.status, 503);
  assert.equal(notReady.body.status, "unavailable");
  assert.equal(notReady.body.reason, "operator_not_authorized");
  const isReady = await ready(makeRail());
  assert.equal(isReady.status, 200);
  assert.equal(isReady.body.status, "ready");

  // That server invites no deposit: no intent, and the app is told payments are off.
  const serviceFor = (rail: MonadRail) =>
    new MissionProductService({ repo: new FileMissionRepository(tempDir()), connectivity: new FakeProvider(), rail, logger: () => {} });
  const blocked = serviceFor(strangerRail);
  const { id } = await blocked.createMission({ destination: BRASIL, ...MISSION_DATES, budgetUsdc: 5, dailyLimitUsdc: 5 });
  await assert.rejects(blocked.createPaymentIntent(id), /503: payments are not available.*operator_not_authorized/);
  assert.equal((await blocked.getCapabilities()).paymentsLive, false);
  const open = serviceFor(makeRail());
  const opened = await open.createMission({ destination: BRASIL, ...MISSION_DATES, budgetUsdc: 5, dailyLimitUsdc: 5 });
  assert.ok((await open.createPaymentIntent(opened.id)).evm);
  assert.equal((await open.getCapabilities()).paymentsLive, true);
});
