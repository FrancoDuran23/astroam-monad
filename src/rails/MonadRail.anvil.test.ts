// End to end against a local chain (anvil): deploy the escrow, deposit with a
// session key, verify the deposit, sign vouchers in the "app", meter against
// them and close. Skipped when Foundry is not installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MonadRail } from "./MonadRail.ts";
import { astroAmEscrowAbi, erc20Abi } from "../shared/monad/abi.ts";
import { voucherDomain, VOUCHER_TYPES } from "../shared/monad/voucher.ts";
import { buildMessage1 } from "../meter/voucher-port.ts";

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

// anvil's well-known dev accounts.
const PAYEE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const TRAVELER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC) });
const payee = privateKeyToAccount(PAYEE_KEY);
const traveler = privateKeyToAccount(TRAVELER_KEY);
const payeeWallet = createWalletClient({ account: payee, chain, transport: http(RPC) });
const travelerWallet = createWalletClient({ account: traveler, chain, transport: http(RPC) });

let anvil: ChildProcess | undefined;
let usdc: Address;
let escrow: Address;

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(fs.readFileSync(path.join("contracts", "out", file, `${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function deploy(art: { abi: Abi; bytecode: Hex }, args: unknown[]): Promise<Address> {
  const hash = await payeeWallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

async function balance(who: Address): Promise<bigint> {
  return client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
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
  const mint = await payeeWallet.writeContract({ address: usdc, abi: mock.abi, functionName: "mint", args: [traveler.address, 100_000_000n] });
  await client.waitForTransactionReceipt({ hash: mint });
  escrow = await deploy(artifact("AstroAmEscrow.sol", "AstroAmEscrow"), [usdc, payee.address, 30n * 24n * 3600n]);
});

after(() => {
  anvil?.kill();
});

test("deposit → app-signed vouchers → metering → close pays usage and refunds the rest", { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-rail-"));
  const rail = new MonadRail({
    rpcUrl: RPC,
    chainId: 31337,
    explorer: "https://explorer.test",
    network: "monad:testnet",
    escrow,
    usdc,
    payeePrivateKey: PAYEE_KEY,
    dataDir,
  });

  // 1. Deposit 5 USDC from the traveler's wallet, registering the app's session key.
  const sessionKey = generatePrivateKey();
  const session = privateKeyToAccount(sessionKey);
  const intent = await rail.createDepositIntent({ missionId: "mis_anvil", amountUsdc: 5, purpose: "mission" });
  assert.ok(intent.evm);
  const escrowId = intent.evm.escrowId as Hex;
  const amount = BigInt(intent.evm.amountAtomic);
  assert.equal(amount, 5_000_000n);
  const approve = await travelerWallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [escrow, amount] });
  await client.waitForTransactionReceipt({ hash: approve });
  const depositTx = await travelerWallet.writeContract({
    address: escrow,
    abi: astroAmEscrowAbi,
    functionName: "deposit",
    args: [escrowId, amount, session.address],
  });

  const confirmed = await rail.confirmDeposit({ missionId: "mis_anvil", intentId: intent.intentId, txHash: depositTx, purpose: "mission" });
  assert.equal(confirmed.valid, true);
  if (!confirmed.valid) return;
  assert.equal(confirmed.channelId, escrowId);
  assert.equal(confirmed.depositRaw, 50_000_000n);
  assert.equal(confirmed.explorerUrl, `https://explorer.test/tx/${depositTx}`);

  // The same transaction cannot confirm twice.
  const again = await rail.confirmDeposit({ missionId: "mis_anvil", intentId: intent.intentId, txHash: depositTx, purpose: "mission" });
  assert.equal(again.valid, false);

  // 2. The app signs a voucher authorizing 2 USDC ahead.
  const sign = (key: Hex, cumulativeAmount: bigint) =>
    privateKeyToAccount(key).signTypedData({
      domain: voucherDomain(31337, escrow),
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { escrowId, cumulativeAmount },
    });
  const accepted = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "2000000", signature: await sign(sessionKey, 2_000_000n) });
  assert.deepEqual(accepted, { accepted: true, authorizedRaw: 20_000_000n });

  const stranger = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "3000000", signature: await sign(generatePrivateKey(), 3_000_000n) });
  assert.deepEqual(stranger, { accepted: false, reason: "bad_signature" });
  const tooMuch = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "6000000", signature: await sign(sessionKey, 6_000_000n) });
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

  // 4. Close: 1.875 USDC used (settled), 3.125 USDC back to the traveler.
  const travelerBefore = await balance(traveler.address);
  const outcome = await rail.closeChannel(escrowId, 18_750_000n);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.equal(outcome.settledRaw, 18_750_000n);
  assert.equal(outcome.refundedRaw, 31_250_000n);
  assert.equal(await balance(payee.address), 1_875_000n);
  assert.equal((await balance(traveler.address)) - travelerBefore, 3_125_000n);
  assert.equal(await balance(escrow), 0n);

  // Settled once: a second close fails, a voucher after close is refused.
  assert.equal((await rail.closeChannel(escrowId, 1n)).kind, "failed");
  const late = await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "4000000", signature: await sign(sessionKey, 4_000_000n) });
  assert.deepEqual(late, { accepted: false, reason: "channel_closed" });
});

test("never settles more than the traveler authorized", { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "monad-rail-"));
  const rail = new MonadRail({ rpcUrl: RPC, chainId: 31337, explorer: "https://explorer.test", network: "monad:testnet", escrow, usdc, payeePrivateKey: PAYEE_KEY, dataDir });
  const sessionKey = generatePrivateKey();
  const intent = await rail.createDepositIntent({ missionId: "mis_cap", amountUsdc: 2, purpose: "mission" });
  const escrowId = intent.evm!.escrowId as Hex;
  const approve = await travelerWallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [escrow, 2_000_000n] });
  await client.waitForTransactionReceipt({ hash: approve });
  const tx = await travelerWallet.writeContract({ address: escrow, abi: astroAmEscrowAbi, functionName: "deposit", args: [escrowId, 2_000_000n, privateKeyToAccount(sessionKey).address] });
  assert.equal((await rail.confirmDeposit({ missionId: "mis_cap", intentId: intent.intentId, txHash: tx, purpose: "mission" })).valid, true);

  const sig = await privateKeyToAccount(sessionKey).signTypedData({
    domain: voucherDomain(31337, escrow),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: { escrowId, cumulativeAmount: 500_000n },
  });
  await rail.submitTravelerVoucher({ channelId: escrowId, cumulativeAmount: "500000", signature: sig });

  // Usage says 1.2 USDC, but only 0.5 USDC was authorized: 0.5 is settled.
  const outcome = await rail.closeChannel(escrowId, 12_000_000n);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind === "closed") {
    assert.equal(outcome.settledRaw, 5_000_000n);
    assert.equal(outcome.refundedRaw, 15_000_000n);
  }
});
