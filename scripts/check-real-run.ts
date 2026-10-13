// Preflight for a run with a real eSIM on Monad testnet. It answers "what is
// still missing?" before any testnet funds or reseller balance are spent.
// Read-only: it sends no transaction, creates no eSIM and funds nothing. The
// chain calls are reads; the Citrus call is GET /wallet/balance.
import "dotenv/config";
import { createPublicClient, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CitrusClient, CITRUS_API_BASE } from "../src/providers/connectivity/CitrusClient.ts";
import { CitrusApiError } from "../src/shared/citrus-errors.ts";
import { getMinRequiredResellerBalanceUsd } from "../src/services/reseller-balance-guard.ts";
import { astroAmEscrowAbi } from "../src/shared/monad/abi.ts";
import { MONAD_CHAIN_ID, MONAD_RPC_URL, MONAD_USDC_ADDRESS } from "../src/shared/monad/constants.ts";
import {
  chainChecks,
  configChecks,
  failureCount,
  providerChecks,
  type ChainFacts,
  type CheckResult,
  type ProviderFacts,
} from "../src/shared/monad/preflight.ts";

const env = process.env;

function print(title: string, results: CheckResult[]): void {
  console.log(`\n${title}`);
  for (const r of results) {
    const tag = r.level === "ok" ? "ok  " : r.level === "warn" ? "warn" : r.level === "info" ? "note" : "FAIL";
    console.log(`  ${tag}  ${r.what}`);
    if (r.fix && r.level !== "ok") console.log(`        fix: ${r.fix}`);
  }
}

const oneLine = (error: unknown): string => {
  const text = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
  return text.split("\n")[0].slice(0, 160);
};

// --- chain -------------------------------------------------------------------

async function readChain(): Promise<ChainFacts> {
  const rpcUrl = env.MONAD_RPC_URL?.trim() || MONAD_RPC_URL;
  const expectedChainId = Number(env.MONAD_CHAIN_ID?.trim()) || MONAD_CHAIN_ID;
  const usdcRaw = env.MONAD_USDC_ADDRESS?.trim() || MONAD_USDC_ADDRESS;
  const escrowRaw = env.MONAD_ESCROW_ADDRESS?.trim();
  const facts: ChainFacts = {
    rpcUrl,
    expectedChainId,
    configuredUsdc: usdcRaw,
    escrowAddress: escrowRaw && isAddress(escrowRaw) ? getAddress(escrowRaw) : undefined,
  };

  const keyRaw = env.MONAD_OPERATOR_PRIVATE_KEY?.trim();
  if (!keyRaw) facts.operatorKeyProblem = "MONAD_OPERATOR_PRIVATE_KEY is not set";
  else if (!/^0x[0-9a-fA-F]{64}$/.test(keyRaw)) facts.operatorKeyProblem = "MONAD_OPERATOR_PRIVATE_KEY is not a 32-byte hex key (0x + 64 hex chars)";
  else facts.operatorKeyAddress = privateKeyToAccount(keyRaw as Hex).address;

  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000, retryCount: 0 }) });
  try {
    facts.chainId = await client.getChainId();
  } catch (error) {
    facts.rpcError = oneLine(error);
    return facts;
  }
  try {
    if (facts.operatorKeyAddress) facts.operatorBalanceWei = await client.getBalance({ address: facts.operatorKeyAddress as Address });
    if (facts.escrowAddress) {
      const code = await client.getCode({ address: facts.escrowAddress as Address });
      facts.escrowHasCode = Boolean(code && code !== "0x");
      if (facts.escrowHasCode) {
        const read = (functionName: "usdc" | "payee" | "operator") =>
          client.readContract({ address: facts.escrowAddress as Address, abi: astroAmEscrowAbi, functionName });
        try {
          const [usdc, payee, operator] = await Promise.all([read("usdc"), read("payee"), read("operator")]);
          facts.escrow = { usdc: usdc as string, payee: payee as string, operator: operator as string };
        } catch {
          facts.escrow = undefined;
        }
      }
    }
  } catch (error) {
    facts.rpcError = oneLine(error);
  }
  return facts;
}

// --- provider ----------------------------------------------------------------

async function readProvider(): Promise<ProviderFacts> {
  const apiKey = env.CITRUS_API_KEY?.trim() ?? "";
  const facts: ProviderFacts = {
    connectivityProvider: env.CONNECTIVITY_PROVIDER,
    apiKeySet: apiKey !== "",
    requiredUsd: getMinRequiredResellerBalanceUsd(),
    webhookSecretSet: Boolean(env.CITRUS_WEBHOOK_SECRET?.trim()),
  };
  if (apiKey === "") return facts;
  try {
    // getWalletBalance is a GET /wallet/balance: it changes nothing.
    const client = new CitrusClient({
      apiKey,
      baseUrl: env.CITRUS_BASE_URL?.trim() || CITRUS_API_BASE,
      requestTimeoutMs: Number(env.CITRUS_REQUEST_TIMEOUT_MS) || undefined,
    });
    const { balanceUsd } = await client.getWalletBalance();
    facts.balance = { balanceUsd };
  } catch (error) {
    const unauthorized = error instanceof CitrusApiError && (error.httpStatus === 401 || error.httpStatus === 403);
    facts.balance = { error: oneLine(error), unauthorized };
  }
  return facts;
}

console.log("Real eSIM run on Monad testnet: preflight (read-only)");

const chain = chainChecks(await readChain());
const provider = providerChecks(await readProvider());
const config = configChecks({
  paymentRail: env.PAYMENT_RAIL,
  liveEnabled: env.ASTROAM_LIVE_ENABLED,
  connectivityProvider: env.CONNECTIVITY_PROVIDER,
  demoTraffic: env.ENABLE_DEMO_TRAFFIC,
  frontendOrigin: env.FRONTEND_ORIGIN,
});

print("Chain and escrow", chain);
print("eSIM provider", provider);
print("Configuration", config);

const failures = failureCount([...chain, ...provider, ...config]);
console.log(
  failures === 0
    ? "\nReady. Start the API (npm run server) and run the trip."
    : `\n${failures} thing${failures === 1 ? "" : "s"} to fix before the run.`,
);
process.exit(failures === 0 ? 0 : 1);
