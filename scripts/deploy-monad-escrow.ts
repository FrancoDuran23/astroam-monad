// Deploy AstroAmEscrow to Monad testnet. Prints the address the receipt
// returns. If there is no key, it prints the exact commands a human must run
// and exits. It never invents a contract address.
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { astroAmEscrowAbi } from "../src/shared/monad/abi.ts";
import {
  DEFAULT_ESCROW_TIMEOUT_SECONDS,
  MONAD_CHAIN_ID,
  MONAD_CHAIN_NAME,
  MONAD_EXPLORER,
  MONAD_RPC_URL,
  MONAD_USDC_ADDRESS,
} from "../src/shared/monad/constants.ts";

const ARTIFACT = join("contracts", "out", "AstroAmEscrow.sol", "AstroAmEscrow.json");

function foundryBin(name: string): string | undefined {
  const fromPath = (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, name))
    .find((path) => existsSync(path));
  if (fromPath) return fromPath;
  const home = process.env.HOME ? join(process.env.HOME, ".foundry", "bin", name) : undefined;
  return home && existsSync(home) ? home : undefined;
}

function humanSteps(): string {
  return [
    "No Monad deployment was sent. There is no deployer key in this environment, and this script will not invent a contract address.",
    "",
    "A human deploys AstroAmEscrow to Monad testnet (chain id 10143) like this:",
    "",
    "  1. Install Foundry: https://book.getfoundry.sh/getting-started/installation",
    "     curl -L https://foundry.paradigm.xyz | bash && foundryup",
    "  2. Get testnet MON for gas: https://faucet.monad.xyz",
    "  3. Get Circle test USDC (Monad Testnet) for the traveler wallet: https://faucet.circle.com",
    "  4. Export the deployer key and the address that should receive used USDC",
    "     (the payee may be the same account as the deployer):",
    "       export MONAD_DEPLOYER_PRIVATE_KEY=0x...",
    "       export MONAD_PAYEE_ADDRESS=0x...",
    "     Optional: export MONAD_TIMEOUT_SECONDS=604800",
    "  5. From the repo root:",
    "       npm run monad:deploy",
    "  6. Copy the printed address into .env as MONAD_ESCROW_ADDRESS and restart the API.",
    "     Do not paste an address this script did not print.",
    "",
    `USDC (verified, 6 decimals): ${MONAD_USDC_ADDRESS}`,
    `RPC: ${MONAD_RPC_URL}`,
  ].join("\n");
}

function forgeBuild(): Promise<void> {
  const forge = foundryBin("forge");
  if (!forge) return Promise.reject(new Error("forge is not installed"));
  return new Promise((resolve, reject) => {
    const child = spawn(forge, ["build", "--root", "contracts"], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`forge build exited ${code}`))));
  });
}

const key = process.env.MONAD_DEPLOYER_PRIVATE_KEY?.trim();
if (!key) {
  console.error(humanSteps());
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("MONAD_DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key (0x + 64 hex chars).");
  process.exit(1);
}

const account = privateKeyToAccount(key as Hex);
const payeeRaw = process.env.MONAD_PAYEE_ADDRESS?.trim() || account.address;
if (!isAddress(payeeRaw)) {
  console.error(`MONAD_PAYEE_ADDRESS is not an address: ${payeeRaw}`);
  process.exit(1);
}
const timeoutRaw = process.env.MONAD_TIMEOUT_SECONDS?.trim();
const timeout = timeoutRaw ? Number(timeoutRaw) : DEFAULT_ESCROW_TIMEOUT_SECONDS;
if (!Number.isInteger(timeout) || timeout <= 0) {
  console.error("MONAD_TIMEOUT_SECONDS must be a positive integer (seconds).");
  process.exit(1);
}

if (!existsSync(ARTIFACT)) {
  await forgeBuild();
}
const compiled = JSON.parse(await readFile(ARTIFACT, "utf8")) as { bytecode: { object: Hex } };
if (!compiled.bytecode?.object || compiled.bytecode.object === "0x") {
  console.error(`Artifact ${ARTIFACT} has no bytecode. Run: forge build --root contracts`);
  process.exit(1);
}

const chain = defineChain({
  id: MONAD_CHAIN_ID,
  name: MONAD_CHAIN_NAME,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: MONAD_EXPLORER } },
});

const publicClient = createPublicClient({ chain, transport: http(MONAD_RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(MONAD_RPC_URL) });

console.log(`Deployer: ${account.address}`);
console.log(`Payee:    ${payeeRaw}`);
console.log(`USDC:     ${MONAD_USDC_ADDRESS}`);
console.log(`Timeout:  ${timeout} seconds`);

const hash = await wallet.deployContract({
  abi: astroAmEscrowAbi,
  bytecode: compiled.bytecode.object,
  args: [MONAD_USDC_ADDRESS, payeeRaw, BigInt(timeout)],
});
console.log(`Deploy tx: ${MONAD_EXPLORER}/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("Deployment transaction did not return a contract address.");
  process.exit(1);
}
console.log("");
console.log(`MONAD_ESCROW_ADDRESS=${receipt.contractAddress}`);
console.log(`MONAD_PAYEE_ADDRESS=${payeeRaw}`);
console.log("Add those two lines to .env and restart the API. This is the address from the receipt, not a placeholder.");
