// Deploy AstroAmEscrow v4 to Monad testnet. It builds the contract first,
// refuses to deploy with the payee and the operator being the same account,
// checks the chain, the deployer's gas and the USDC token before sending, and
// reads the contract back afterwards. With MONAD_ESCROW_ADDRESS already set it
// only verifies that contract against the environment (--force deploys anyway).
// It never prints a private key and never invents a contract address.
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
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
import { deployBlockers, escrowConfigMismatches } from "../src/shared/monad/preflight.ts";

const ARTIFACT = join("contracts", "out", "AstroAmEscrow.sol", "AstroAmEscrow.json");
const env = process.env;
const args = new Set(process.argv.slice(2));
const allowSameKey = args.has("--allow-same-key");
const force = args.has("--force");

function foundryBin(name: string): string | undefined {
  const fromPath = (env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, name))
    .find((path) => existsSync(path));
  if (fromPath) return fromPath;
  const home = env.HOME ?? "";
  return [join(home, ".foundry", "bin", name), join(home, ".config", ".foundry", "bin", name)].find((path) => existsSync(path));
}

function usage(): string {
  return [
    "Deploys AstroAmEscrow v4 to Monad testnet (chain id 10143). Nothing was sent.",
    "",
    "  1. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup",
    "  2. Get testnet MON for the deployer: https://faucet.monad.xyz",
    "  3. Export these in the shell (do not write the deployer key into .env):",
    "       export MONAD_DEPLOYER_PRIVATE_KEY=0x...   # pays gas for the deploy only",
    "       export MONAD_PAYEE_ADDRESS=0x...          # where the USDC goes: a cold wallet or multisig",
    "       export MONAD_OPERATOR_ADDRESS=0x...       # the address of the server key (MONAD_OPERATOR_PRIVATE_KEY)",
    "     Optional: MONAD_TIMEOUT_SECONDS (refund window, default 2592000 = 30 days),",
    "     MONAD_RPC_URL, MONAD_CHAIN_ID, MONAD_USDC_ADDRESS, MONAD_EXPLORER_URL.",
    "  4. From the repo root: npm run monad:deploy",
    "  5. Paste the lines it prints into .env and restart the API. Do not paste an address it did not print.",
    "",
    "Flags: --allow-same-key (payee = operator, local testing only), --force (deploy even if MONAD_ESCROW_ADDRESS is set).",
    "With MONAD_ESCROW_ADDRESS set it does not deploy: it checks that contract against these values.",
  ].join("\n");
}

function stop(lines: string[], showUsage = false): never {
  for (const line of lines) console.error(line);
  if (showUsage) console.error(`\n${usage()}`);
  process.exit(1);
}

function oneLine(error: unknown): string {
  const text = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
  return text.split("\n")[0].slice(0, 200);
}

function forgeBuild(): Promise<void> {
  const forge = foundryBin("forge");
  if (!forge) return Promise.reject(new Error("forge is not installed: curl -L https://foundry.paradigm.xyz | bash && foundryup"));
  return new Promise((resolve, reject) => {
    const child = spawn(forge, ["build", "--root", "contracts"], { stdio: "inherit" });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`forge build failed (exit ${code}): fix the contract errors above`))));
  });
}

// --- read and validate the environment (no network yet) --------------------

const problems: string[] = [];
const addressVar = (name: string): Address | undefined => {
  const raw = env[name]?.trim();
  if (!raw) {
    problems.push(`${name} is not set: ${hint(name)}`);
    return undefined;
  }
  if (!isAddress(raw)) {
    problems.push(`${name} is not an address: ${raw}`);
    return undefined;
  }
  return getAddress(raw);
};
function hint(name: string): string {
  if (name === "MONAD_PAYEE_ADDRESS") return "export the address that should receive the USDC (cold wallet or multisig)";
  return "export the address of the server key (MONAD_OPERATOR_PRIVATE_KEY)";
}

const payee = addressVar("MONAD_PAYEE_ADDRESS");
const operator = addressVar("MONAD_OPERATOR_ADDRESS");

const usdcRaw = env.MONAD_USDC_ADDRESS?.trim() || MONAD_USDC_ADDRESS;
if (!isAddress(usdcRaw)) problems.push(`MONAD_USDC_ADDRESS is not an address: ${usdcRaw}`);
const usdc = isAddress(usdcRaw) ? getAddress(usdcRaw) : undefined;

const rpcUrl = env.MONAD_RPC_URL?.trim() || MONAD_RPC_URL;
const chainIdRaw = env.MONAD_CHAIN_ID?.trim();
const chainId = chainIdRaw ? Number(chainIdRaw) : MONAD_CHAIN_ID;
if (!Number.isInteger(chainId) || chainId <= 0) problems.push(`MONAD_CHAIN_ID is not a positive integer: ${chainIdRaw}`);
const explorer = env.MONAD_EXPLORER_URL?.trim() || MONAD_EXPLORER;

const timeoutRaw = env.MONAD_TIMEOUT_SECONDS?.trim();
const timeout = timeoutRaw ? Number(timeoutRaw) : DEFAULT_ESCROW_TIMEOUT_SECONDS;
if (!Number.isInteger(timeout) || timeout <= 0) problems.push("MONAD_TIMEOUT_SECONDS must be a positive integer (seconds)");

const existingRaw = env.MONAD_ESCROW_ADDRESS?.trim();
if (existingRaw && !isAddress(existingRaw)) problems.push(`MONAD_ESCROW_ADDRESS is not an address: ${existingRaw}`);
const verifyOnly = Boolean(existingRaw) && !force;

const deployerKey = env.MONAD_DEPLOYER_PRIVATE_KEY?.trim();
if (!verifyOnly) {
  if (!deployerKey) problems.push("MONAD_DEPLOYER_PRIVATE_KEY is not set: export the key that pays gas for the deploy");
  else if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) problems.push("MONAD_DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key (0x + 64 hex chars)");
}
if (payee && operator && payee === operator && !allowSameKey && !verifyOnly) {
  problems.push(
    "MONAD_PAYEE_ADDRESS and MONAD_OPERATOR_ADDRESS are the same account. The point of v4 is keeping them apart, so a stolen server key cannot take the funds: use a different payee, or pass --allow-same-key for local testing",
  );
}

if (problems.length > 0) {
  const missingAll = !payee && !operator && !deployerKey && !existingRaw;
  stop(problems.map((p) => `ERROR ${p}`), missingAll || problems.some((p) => p.includes("is not set")));
}

const chain = defineChain({
  id: chainId,
  name: MONAD_CHAIN_NAME,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "MonadVision", url: explorer } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const expected = {
  usdc: usdc as Address,
  payee: payee as Address,
  operator: operator as Address,
  timeoutSeconds: timeoutRaw ? BigInt(timeout) : undefined,
};

async function readConfig(address: Address) {
  const read = (functionName: "usdc" | "payee" | "operator" | "timeoutSeconds") =>
    publicClient.readContract({ address, abi: astroAmEscrowAbi, functionName });
  const [u, p, o, t] = await Promise.all([read("usdc"), read("payee"), read("operator"), read("timeoutSeconds")]);
  return { usdc: u as string, payee: p as string, operator: o as string, timeoutSeconds: BigInt(t as bigint) };
}

function printEnvLines(address: string): void {
  console.log("");
  console.log("Paste these into .env (the address comes from the chain, not a placeholder):");
  console.log("PAYMENT_RAIL=monad");
  console.log(`MONAD_ESCROW_ADDRESS=${address}`);
  console.log("MONAD_OPERATOR_PRIVATE_KEY=<the key of " + `${expected.operator}>`);
  if (rpcUrl !== MONAD_RPC_URL) console.log(`MONAD_RPC_URL=${rpcUrl}`);
  if (chainId !== MONAD_CHAIN_ID) console.log(`MONAD_CHAIN_ID=${chainId}`);
  if (expected.usdc !== getAddress(MONAD_USDC_ADDRESS)) console.log(`MONAD_USDC_ADDRESS=${expected.usdc}`);
  console.log(`Explorer: ${explorer}/address/${address}`);
  console.log("Next: npm run real:check");
}

try {
  // --- an escrow is already configured: verify it, do not deploy ----------
  if (verifyOnly) {
    const address = getAddress(existingRaw as string);
    console.log(`MONAD_ESCROW_ADDRESS is already set (${address}); not deploying. Pass --force to deploy a new one.`);
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") stop([`ERROR no contract at ${address} on chain ${chainId}: check MONAD_ESCROW_ADDRESS and MONAD_RPC_URL`]);
    let actual;
    try {
      actual = await readConfig(address);
    } catch {
      stop([`ERROR ${address} does not answer usdc(), payee(), operator() and timeoutSeconds(): it is not an escrow v4`]);
    }
    console.log(`  usdc()           ${actual.usdc}`);
    console.log(`  payee()          ${actual.payee}`);
    console.log(`  operator()       ${actual.operator}`);
    console.log(`  timeoutSeconds() ${actual.timeoutSeconds}`);
    const mismatches = escrowConfigMismatches(expected, actual);
    if (mismatches.length > 0) {
      stop([...mismatches.map((m) => `MISMATCH ${m}`), "ERROR this escrow does not match your environment: fix the variables, or pass --force to deploy a new escrow"]);
    }
    console.log("OK this escrow matches MONAD_USDC_ADDRESS, MONAD_PAYEE_ADDRESS and MONAD_OPERATOR_ADDRESS.");
    printEnvLines(address);
    process.exit(0);
  }

  // --- deploy --------------------------------------------------------------
  await forgeBuild();
  if (!existsSync(ARTIFACT)) stop([`ERROR forge build produced no ${ARTIFACT}`]);
  const compiled = JSON.parse(await readFile(ARTIFACT, "utf8")) as {
    bytecode: { object: Hex };
    abi: { type: string; name?: string; inputs?: unknown[] }[];
  };
  const ctor = compiled.abi?.find((item) => item.type === "constructor");
  if (!compiled.bytecode?.object || compiled.bytecode.object === "0x") stop([`ERROR ${ARTIFACT} has no bytecode: run forge build --root contracts`]);
  if (ctor?.inputs?.length !== 4) stop([`ERROR ${ARTIFACT} is not escrow v4 (constructor takes ${ctor?.inputs?.length ?? 0} arguments, v4 takes 4): check out the v4 contract and rebuild`]);

  const account = privateKeyToAccount(deployerKey as Hex);
  console.log(`Deployer: ${account.address}`);
  console.log(`Payee:    ${expected.payee}`);
  console.log(`Operator: ${expected.operator}`);
  console.log(`USDC:     ${expected.usdc}`);
  console.log(`Timeout:  ${timeout} seconds`);
  console.log(`RPC:      ${rpcUrl} (chain ${chainId})`);

  const erc20 = parseAbi(["function decimals() view returns (uint8)"]);
  const [rpcChainId, deployerBalanceWei, usdcCode] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: account.address }),
    publicClient.getCode({ address: expected.usdc }),
  ]);
  const usdcHasCode = Boolean(usdcCode && usdcCode !== "0x");
  let usdcDecimals: number | undefined;
  if (usdcHasCode) {
    try {
      usdcDecimals = Number(await publicClient.readContract({ address: expected.usdc, abi: erc20, functionName: "decimals" }));
    } catch {
      usdcDecimals = undefined;
    }
  }
  const blockers = deployBlockers(
    { rpcChainId, expectedChainId: chainId, deployerBalanceWei, usdcHasCode, usdcDecimals },
    rpcUrl,
    expected.usdc,
    account.address,
  );
  if (blockers.length > 0) stop(blockers.map((b) => `ERROR ${b}`));

  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const hash = await wallet.deployContract({
    abi: astroAmEscrowAbi,
    bytecode: compiled.bytecode.object,
    args: [expected.usdc, expected.payee, expected.operator, BigInt(timeout)],
  });
  console.log(`Deploy tx: ${explorer}/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    stop(["ERROR the deployment transaction did not return a contract address: open the transaction above to see why"]);
  }
  const address = getAddress(receipt.contractAddress as string);

  const actual = await readConfig(address);
  const mismatches = escrowConfigMismatches({ ...expected, timeoutSeconds: BigInt(timeout) }, actual);
  if (mismatches.length > 0) {
    stop([...mismatches.map((m) => `MISMATCH ${m}`), `ERROR the contract at ${address} does not hold the configuration that was sent: do not use it`]);
  }
  console.log(`Verified on chain: usdc(), payee(), operator() and timeoutSeconds() match (${actual.timeoutSeconds} seconds).`);
  if (expected.payee === expected.operator) console.log("WARNING payee and operator are the same account (--allow-same-key): local testing only.");
  printEnvLines(address);
} catch (error) {
  stop([`ERROR ${oneLine(error)}`, "Check MONAD_RPC_URL and the variables above, then run again. Nothing is recorded until the address is printed."]);
}
