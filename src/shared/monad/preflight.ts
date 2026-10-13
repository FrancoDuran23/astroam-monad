// Pure checks behind `npm run real:check` and `npm run monad:deploy`. They take
// values that were already read and return results, so they can be tested
// without a network. scripts/check-real-run.ts and scripts/deploy-monad-escrow.ts
// are the thin layers that read the values.

export type CheckLevel = "ok" | "info" | "warn" | "fail";
export type CheckResult = { level: CheckLevel; what: string; fix?: string };

import { isWildcardOrigin } from "../../product/api/cors.ts";

const ok = (what: string): CheckResult => ({ level: "ok", what });
const info = (what: string, fix?: string): CheckResult => ({ level: "info", what, fix });
const warn = (what: string, fix?: string): CheckResult => ({ level: "warn", what, fix });
const fail = (what: string, fix: string): CheckResult => ({ level: "fail", what, fix });

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Gas reserve (in wei) below which an account is reported as unfunded: 0.05 MON. */
export const MIN_GAS_WEI = 50_000_000_000_000_000n;

// ---------------------------------------------------------------------------
// escrow configuration: shared by the deploy read-back and the verify path
// ---------------------------------------------------------------------------

export type EscrowConfig = { usdc: string; payee: string; operator: string; timeoutSeconds: bigint };

/** One line per field that differs. `timeoutSeconds` undefined means "not specified, do not compare". */
export function escrowConfigMismatches(
  expected: { usdc: string; payee: string; operator: string; timeoutSeconds?: bigint },
  actual: EscrowConfig,
): string[] {
  const lines: string[] = [];
  if (!sameAddress(expected.usdc, actual.usdc)) lines.push(`usdc() is ${actual.usdc}, expected ${expected.usdc}`);
  if (!sameAddress(expected.payee, actual.payee)) lines.push(`payee() is ${actual.payee}, expected ${expected.payee}`);
  if (!sameAddress(expected.operator, actual.operator)) lines.push(`operator() is ${actual.operator}, expected ${expected.operator}`);
  if (expected.timeoutSeconds !== undefined && expected.timeoutSeconds !== actual.timeoutSeconds) {
    lines.push(`timeoutSeconds() is ${actual.timeoutSeconds}, expected ${expected.timeoutSeconds}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// deploy preconditions
// ---------------------------------------------------------------------------

export type DeployFacts = {
  rpcChainId: number;
  expectedChainId: number;
  deployerBalanceWei: bigint;
  usdcHasCode: boolean;
  usdcDecimals: number | undefined;
};

/** Everything that must hold before the deploy transaction is sent. */
export function deployBlockers(facts: DeployFacts, rpcUrl: string, usdc: string, deployer: string): string[] {
  const lines: string[] = [];
  if (facts.rpcChainId !== facts.expectedChainId) {
    lines.push(
      `the RPC ${rpcUrl} is chain ${facts.rpcChainId}, not ${facts.expectedChainId}: fix MONAD_RPC_URL or MONAD_CHAIN_ID`,
    );
  }
  if (facts.deployerBalanceWei < MIN_GAS_WEI) {
    lines.push(`the deployer ${deployer} has too little MON for gas: get testnet MON from https://faucet.monad.xyz`);
  }
  if (!facts.usdcHasCode) {
    lines.push(`MONAD_USDC_ADDRESS ${usdc} has no code on this chain: fix the address or the RPC`);
  } else if (facts.usdcDecimals !== 6) {
    lines.push(`MONAD_USDC_ADDRESS ${usdc} reports ${facts.usdcDecimals ?? "no"} decimals, the escrow expects 6: use a 6-decimal USDC`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// preflight: chain
// ---------------------------------------------------------------------------

export type ChainFacts = {
  rpcUrl: string;
  /** Set when the RPC could not be reached; the remaining chain facts are then unknown. */
  rpcError?: string;
  chainId?: number;
  expectedChainId: number;
  escrowAddress?: string;
  escrowHasCode?: boolean;
  /** Read from the contract; undefined when the call failed. */
  escrow?: { usdc: string; payee: string; operator: string };
  configuredUsdc: string;
  /** Address of MONAD_OPERATOR_PRIVATE_KEY; undefined when the key is missing or invalid. */
  operatorKeyAddress?: string;
  operatorKeyProblem?: string;
  operatorBalanceWei?: bigint;
};

export function chainChecks(f: ChainFacts): CheckResult[] {
  const out: CheckResult[] = [];
  if (f.rpcError !== undefined) {
    out.push(fail(`RPC ${f.rpcUrl} unreachable (${f.rpcError})`, "check MONAD_RPC_URL and your connection"));
    return out;
  }
  out.push(ok(`RPC ${f.rpcUrl} reachable`));
  if (f.chainId !== f.expectedChainId) {
    out.push(fail(`chain id is ${f.chainId}, expected ${f.expectedChainId}`, "fix MONAD_RPC_URL or MONAD_CHAIN_ID"));
  } else {
    out.push(ok(`chain id ${f.chainId}`));
  }

  if (!f.escrowAddress) {
    out.push(fail("MONAD_ESCROW_ADDRESS is not set or not an address", "run npm run monad:deploy and paste the MONAD_ESCROW_ADDRESS line it prints"));
  } else if (!f.escrowHasCode) {
    out.push(fail(`no contract at ${f.escrowAddress}`, "check MONAD_ESCROW_ADDRESS against the deploy output, and the RPC"));
  } else if (!f.escrow) {
    out.push(fail(`${f.escrowAddress} does not answer usdc(), payee() and operator()`, "it is not an escrow v4; deploy with npm run monad:deploy"));
  } else {
    out.push(ok(`escrow ${f.escrowAddress} has code`));
    if (sameAddress(f.escrow.usdc, f.configuredUsdc)) {
      out.push(ok(`escrow usdc() matches ${f.configuredUsdc}`));
    } else {
      out.push(fail(`escrow usdc() is ${f.escrow.usdc}, configured ${f.configuredUsdc}`, `set MONAD_USDC_ADDRESS=${f.escrow.usdc}, or point MONAD_ESCROW_ADDRESS at an escrow for ${f.configuredUsdc}`));
    }
    if (f.operatorKeyAddress === undefined) {
      out.push(fail(f.operatorKeyProblem ?? "MONAD_OPERATOR_PRIVATE_KEY is not set", "set MONAD_OPERATOR_PRIVATE_KEY to the key of the escrow's operator (0x + 64 hex)"));
    } else if (sameAddress(f.operatorKeyAddress, f.escrow.operator)) {
      out.push(ok(`operator key ${f.operatorKeyAddress} is the escrow's operator()`));
    } else if (sameAddress(f.operatorKeyAddress, f.escrow.payee)) {
      out.push(ok(`operator key ${f.operatorKeyAddress} is the escrow's payee()`));
    } else {
      out.push(fail(`operator key ${f.operatorKeyAddress} is neither operator() ${f.escrow.operator} nor payee() ${f.escrow.payee}`, `use the key of ${f.escrow.operator}, or have the payee call setOperator(${f.operatorKeyAddress})`));
    }
    if (f.operatorKeyAddress !== undefined) {
      if (sameAddress(f.operatorKeyAddress, f.escrow.payee)) {
        out.push(warn("the operator key is also the payee: a stolen server key is stolen funds", "deploy v4 with a separate MONAD_PAYEE_ADDRESS (cold wallet or multisig)"));
      } else {
        out.push(ok(`payee() ${f.escrow.payee} differs from the operator`));
      }
    }
  }

  if (f.operatorKeyAddress === undefined && !f.escrow) {
    out.push(fail(f.operatorKeyProblem ?? "MONAD_OPERATOR_PRIVATE_KEY is not set", "set MONAD_OPERATOR_PRIVATE_KEY to the key of the escrow's operator (0x + 64 hex)"));
  }
  if (f.operatorKeyAddress !== undefined && f.operatorBalanceWei !== undefined) {
    if (f.operatorBalanceWei < MIN_GAS_WEI) {
      out.push(fail(`operator ${f.operatorKeyAddress} has too little MON for gas`, "send it testnet MON from https://faucet.monad.xyz"));
    } else {
      out.push(ok(`operator holds ${formatMon(f.operatorBalanceWei)} MON`));
    }
  }
  return out;
}

export function formatMon(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) / 10n ** 14n; // 4 decimals
  return `${whole}.${frac.toString().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// preflight: provider
// ---------------------------------------------------------------------------

export type ProviderFacts = {
  connectivityProvider: string | undefined;
  apiKeySet: boolean;
  /** Outcome of GET /wallet/balance; undefined when it was not attempted. */
  balance?: { balanceUsd: number } | { error: string; unauthorized: boolean };
  requiredUsd: number;
  webhookSecretSet: boolean;
};

export function providerChecks(f: ProviderFacts): CheckResult[] {
  const out: CheckResult[] = [];
  if (f.connectivityProvider === "citrus") out.push(ok("CONNECTIVITY_PROVIDER=citrus"));
  else out.push(fail(`CONNECTIVITY_PROVIDER is "${f.connectivityProvider ?? ""}"`, "set CONNECTIVITY_PROVIDER=citrus"));

  if (!f.apiKeySet) {
    out.push(fail("CITRUS_API_KEY is empty", "paste the reseller key (rsk_...) from the Citrus dashboard"));
  } else if (f.balance === undefined) {
    out.push(fail("the Citrus balance was not checked", "fix the lines above and run again"));
  } else if ("error" in f.balance) {
    out.push(
      f.balance.unauthorized
        ? fail("Citrus rejected the API key", "generate a new reseller key in the Citrus dashboard and set CITRUS_API_KEY")
        : fail(`could not read the Citrus balance (${f.balance.error})`, "check CITRUS_BASE_URL and your connection, then run again"),
    );
  } else {
    out.push(ok("Citrus accepted the API key"));
    if (f.balance.balanceUsd < f.requiredUsd) {
      out.push(fail(`reseller balance is $${f.balance.balanceUsd.toFixed(2)}, one eSIM plus one tranche needs $${f.requiredUsd.toFixed(2)}`, "top up the reseller wallet in the Citrus dashboard"));
    } else {
      out.push(ok(`reseller balance $${f.balance.balanceUsd.toFixed(2)} covers $${f.requiredUsd.toFixed(2)} (one eSIM plus one tranche)`));
    }
  }

  if (f.webhookSecretSet) out.push(ok("CITRUS_WEBHOOK_SECRET is set"));
  else out.push(fail("CITRUS_WEBHOOK_SECRET is empty", "set the webhook secret from the Citrus dashboard; without it /citrus/webhooks is off"));
  return out;
}

// ---------------------------------------------------------------------------
// preflight: configuration
// ---------------------------------------------------------------------------

export type ConfigFacts = {
  paymentRail: string | undefined;
  liveEnabled: string | undefined;
  demoTraffic: string | undefined;
  connectivityProvider: string | undefined;
  frontendOrigin: string | undefined;
};

/** localhost, loopback or a private LAN address (phone testing on the same Wi-Fi). */
export function isLocalOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "[::1]" || host === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function configChecks(f: ConfigFacts): CheckResult[] {
  const out: CheckResult[] = [];
  if (f.paymentRail === "monad") out.push(ok("PAYMENT_RAIL=monad"));
  else out.push(fail(`PAYMENT_RAIL is "${f.paymentRail ?? ""}"`, "set PAYMENT_RAIL=monad"));

  if (f.demoTraffic === "false") out.push(ok("ENABLE_DEMO_TRAFFIC=false: usage is what the carrier reports"));
  else out.push(fail(`ENABLE_DEMO_TRAFFIC is "${f.demoTraffic ?? ""}", so usage can still be invented`, "set ENABLE_DEMO_TRAFFIC=false"));

  // Live mode is informational: the frontend sends no access token, so in live
  // mode every route that creates or changes a mission answers 401.
  if (f.liveEnabled === "true") {
    out.push(warn("ASTROAM_LIVE_ENABLED=true: the app does not send the access token, so trips cannot be created from it in live mode", "leave ASTROAM_LIVE_ENABLED=false for a run driven from the app"));
  } else {
    out.push(info("ASTROAM_LIVE_ENABLED is off: right for a run driven from the app (live mode needs a token the app does not send)"));
  }

  const raw = (f.frontendOrigin ?? "").trim();
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0) {
    out.push(fail("FRONTEND_ORIGIN is empty", "set it to the app's origin, e.g. http://localhost:5173"));
  } else if (isWildcardOrigin(raw)) {
    out.push(fail("FRONTEND_ORIGIN is a wildcard (*)", "list the real origin(s) instead of *"));
  } else if (f.connectivityProvider === "citrus" && origins.some((o) => !isLocalOrigin(o))) {
    const bad = origins.filter((o) => !isLocalOrigin(o)).join(",");
    out.push(fail(`FRONTEND_ORIGIN includes ${bad}: with real Citrus a public app lets anyone spend the reseller balance, since testnet funds are free`, "run the real eSIM on a laptop: use only localhost, 127.0.0.1 or a private LAN address"));
  } else {
    out.push(ok(`FRONTEND_ORIGIN=${origins.join(",")}`));
  }
  return out;
}

export function failureCount(results: CheckResult[]): number {
  return results.filter((r) => r.level === "fail").length;
}
