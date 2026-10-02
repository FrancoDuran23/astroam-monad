// Deploys the compiled escrow on a local anvil and checks that viem's EIP-712
// digest is the one the contract recovers. Skips when forge/anvil are absent
// (the Foundry suite in contracts/ is the source of the deposit/close/refund
// cases; this file is the app-side encoding check).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  publicActions,
  walletActions,
  hashTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { astroAmEscrowAbi } from "./abi.ts";
import { closeVoucherTypedData, escrowIdForMission } from "./voucher.ts";

const PORT = 18545;
const TIMEOUT = 3600;

function bin(name: string): string | undefined {
  const fromPath = (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, name))
    .find((path) => existsSync(path));
  if (fromPath) return fromPath;
  const home = process.env.HOME ? join(process.env.HOME, ".foundry", "bin", name) : undefined;
  return home && existsSync(home) ? home : undefined;
}

async function artifact(name: string): Promise<{ abi: readonly unknown[]; bytecode: Hex }> {
  const forge = bin("forge");
  const out = join("contracts", "out");
  const escrowPath = join(out, "AstroAmEscrow.sol", "AstroAmEscrow.json");
  if (!existsSync(escrowPath) && forge) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(forge, ["build", "--root", "contracts"], { stdio: "ignore" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`forge build exited ${code}`))));
    });
  }
  const file =
    name === "escrow"
      ? escrowPath
      : join(out, "AstroAmEscrow.t.sol", "MockUsdc.json");
  const json = JSON.parse(await readFile(file, "utf8")) as { abi: readonly unknown[]; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

test("viem voucher matches the contract: deposit, close-with-refund, timeout refund", async (t) => {
  const anvil = bin("anvil");
  if (!anvil) {
    t.skip("anvil is not installed");
    return;
  }

  let escrowArtifact: { abi: readonly unknown[]; bytecode: Hex };
  let usdcArtifact: { abi: readonly unknown[]; bytecode: Hex };
  try {
    escrowArtifact = await artifact("escrow");
    usdcArtifact = await artifact("usdc");
  } catch {
    t.skip("forge build did not produce escrow artifacts");
    return;
  }

  const child = spawn(anvil, ["--port", String(PORT), "--silent"], {
    stdio: "ignore",
  });
  const rpc = `http://127.0.0.1:${PORT}`;
  const chain = defineChain({
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });

  try {
    const publicClient = createPublicClient({ chain, transport: http(rpc) });
    const testClient = createTestClient({ chain, mode: "anvil", transport: http(rpc) }).extend(publicActions).extend(walletActions);
    for (let i = 0; i < 50; i += 1) {
      try {
        await publicClient.getChainId();
        break;
      } catch (error) {
        if (i === 49) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const deployer = privateKeyToAccount(generatePrivateKey());
    const traveler = privateKeyToAccount(generatePrivateKey());
    const payee = privateKeyToAccount(generatePrivateKey());
    for (const account of [deployer, traveler, payee]) {
      await testClient.setBalance({ address: account.address, value: parseEther("10") });
    }
    const deployerWallet = createWalletClient({ account: deployer, chain, transport: http(rpc) });
    const travelerWallet = createWalletClient({ account: traveler, chain, transport: http(rpc) });

    const usdcHash = await deployerWallet.deployContract({
      abi: usdcArtifact.abi,
      bytecode: usdcArtifact.bytecode,
      args: [6],
    });
    const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash });
    const usdc = usdcReceipt.contractAddress as Address;
    assert.ok(usdc);

    const escrowHash = await deployerWallet.deployContract({
      abi: astroAmEscrowAbi,
      bytecode: escrowArtifact.bytecode,
      args: [usdc, payee.address, BigInt(TIMEOUT)],
    });
    const escrowReceipt = await publicClient.waitForTransactionReceipt({ hash: escrowHash });
    const escrow = escrowReceipt.contractAddress as Address;
    assert.ok(escrow);

    const decimals = await publicClient.readContract({ address: escrow, abi: astroAmEscrowAbi, functionName: "usdcDecimals" });
    assert.equal(decimals, 6);

    const mintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
    const approveAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
    const balanceAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

    const depositAmount = 5_000_000n;
    const used = 500_000n;
    await deployerWallet.writeContract({ address: usdc, abi: mintAbi, functionName: "mint", args: [traveler.address, 1_000_000_000n] });
    await travelerWallet.writeContract({ address: usdc, abi: approveAbi, functionName: "approve", args: [escrow, depositAmount] });

    const escrowId = escrowIdForMission("mis_anvil");
    await travelerWallet.writeContract({
      address: escrow,
      abi: astroAmEscrowAbi,
      functionName: "deposit",
      args: [escrowId, depositAmount],
    });

    // The contract was deployed on anvil (chain 31337). Rebuild the domain
    // with that chain id; production plans use 10143, same type hash.
    const typed = closeVoucherTypedData({ escrow, escrowId, cumulativeAmount: used });
    const anvilTyped = { ...typed, domain: { ...typed.domain, chainId: 31337 } };
    const localDigest = hashTypedData(anvilTyped);
    const onChainDigest = await publicClient.readContract({
      address: escrow,
      abi: astroAmEscrowAbi,
      functionName: "voucherHash",
      args: [escrowId, used],
    });
    assert.equal(localDigest, onChainDigest);

    const signature = await travelerWallet.signTypedData(anvilTyped);
    const payeeWallet = createWalletClient({ account: payee, chain, transport: http(rpc) });
    const closeHash = await payeeWallet.writeContract({
      address: escrow,
      abi: astroAmEscrowAbi,
      functionName: "close",
      args: [escrowId, used, signature],
    });
    const closeReceipt = await publicClient.waitForTransactionReceipt({ hash: closeHash });
    assert.equal(closeReceipt.status, "success");

    const payeeBalance = await publicClient.readContract({ address: usdc, abi: balanceAbi, functionName: "balanceOf", args: [payee.address] });
    const travelerBalance = await publicClient.readContract({ address: usdc, abi: balanceAbi, functionName: "balanceOf", args: [traveler.address] });
    assert.equal(payeeBalance, used);
    assert.equal(travelerBalance, 1_000_000_000n - used);

    const refundId = escrowIdForMission("mis_timeout");
    await travelerWallet.writeContract({ address: usdc, abi: approveAbi, functionName: "approve", args: [escrow, depositAmount] });
    await travelerWallet.writeContract({
      address: escrow,
      abi: astroAmEscrowAbi,
      functionName: "deposit",
      args: [refundId, depositAmount],
    });
    await assert.rejects(
      travelerWallet.writeContract({ address: escrow, abi: astroAmEscrowAbi, functionName: "refund", args: [refundId] }),
    );
    await testClient.increaseTime({ seconds: TIMEOUT });
    await testClient.mine({ blocks: 1 });
    const refundHash = await travelerWallet.writeContract({
      address: escrow,
      abi: astroAmEscrowAbi,
      functionName: "refund",
      args: [refundId],
    });
    const refundReceipt = await publicClient.waitForTransactionReceipt({ hash: refundHash });
    assert.equal(refundReceipt.status, "success");
    const afterRefund = await publicClient.readContract({
      address: usdc,
      abi: balanceAbi,
      functionName: "balanceOf",
      args: [traveler.address],
    });
    assert.equal(afterRefund, 1_000_000_000n - used);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
