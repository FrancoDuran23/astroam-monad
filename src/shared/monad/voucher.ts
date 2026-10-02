import { getAddress, isAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import {
  DEFAULT_ESCROW_TIMEOUT_SECONDS,
  MONAD_CHAIN_ID,
  MONAD_CHAIN_ID_HEX,
  MONAD_CHAIN_NAME,
  MONAD_EXPLORER,
  MONAD_RPC_URL,
  MONAD_USDC_ADDRESS,
  MONAD_USDC_DECIMALS,
  VOUCHER_DOMAIN_NAME,
  VOUCHER_DOMAIN_VERSION,
} from "./constants.ts";
import { formatAtomic, usageAtomic, usdcToMonadAtomic } from "./amounts.ts";

export const CLOSE_VOUCHER_TYPES = {
  CloseVoucher: [
    { name: "escrowId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint256" },
  ],
} as const;

export function escrowIdForMission(missionId: string): Hex {
  return keccak256(toBytes(`astroam-escrow:${missionId}`));
}

export function readAddress(value: string | undefined): Address | null {
  const trimmed = value?.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

export type CloseVoucherTypedData = {
  domain: {
    name: typeof VOUCHER_DOMAIN_NAME;
    version: typeof VOUCHER_DOMAIN_VERSION;
    chainId: typeof MONAD_CHAIN_ID;
    verifyingContract: Address;
  };
  types: typeof CLOSE_VOUCHER_TYPES;
  primaryType: "CloseVoucher";
  message: {
    escrowId: Hex;
    cumulativeAmount: bigint;
  };
};

/** EIP-712 payload the traveler signs. The contract recovers this exact digest. */
export function closeVoucherTypedData(params: {
  escrow: Address;
  escrowId: Hex;
  cumulativeAmount: bigint;
}): CloseVoucherTypedData {
  return {
    domain: {
      name: VOUCHER_DOMAIN_NAME,
      version: VOUCHER_DOMAIN_VERSION,
      chainId: MONAD_CHAIN_ID,
      verifyingContract: params.escrow,
    },
    types: CLOSE_VOUCHER_TYPES,
    primaryType: "CloseVoucher",
    message: {
      escrowId: params.escrowId,
      cumulativeAmount: params.cumulativeAmount,
    },
  };
}

export type MonadDepositPlan = {
  chainId: typeof MONAD_CHAIN_ID;
  chainIdHex: typeof MONAD_CHAIN_ID_HEX;
  chainName: typeof MONAD_CHAIN_NAME;
  rpcUrl: typeof MONAD_RPC_URL;
  explorer: typeof MONAD_EXPLORER;
  nativeCurrency: { name: "Monad"; symbol: "MON"; decimals: 18 };
  usdc: typeof MONAD_USDC_ADDRESS;
  usdcDecimals: typeof MONAD_USDC_DECIMALS;
  escrow: Address | null;
  payee: Address | null;
  escrowId: Hex;
  amount: string;
  amountUsdc: string;
  timeoutSeconds: number;
  deployed: boolean;
};

export type MonadClosePlan = MonadDepositPlan & {
  cumulativeAmount: string;
  refundAtomic: string;
  usedUsdc: string;
  refundUsdc: string;
  typedData: {
    domain: CloseVoucherTypedData["domain"];
    types: CloseVoucherTypedData["types"];
    primaryType: "CloseVoucher";
    message: { escrowId: Hex; cumulativeAmount: string };
  } | null;
};

function timeoutFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.MONAD_TIMEOUT_SECONDS;
  if (!raw) return DEFAULT_ESCROW_TIMEOUT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_ESCROW_TIMEOUT_SECONDS;
  return parsed;
}

export function buildDepositPlan(params: {
  missionId: string;
  budgetUsdc: number;
  env?: Record<string, string | undefined>;
}): MonadDepositPlan {
  const env = params.env ?? process.env;
  const escrow = readAddress(env.MONAD_ESCROW_ADDRESS);
  const payee = readAddress(env.MONAD_PAYEE_ADDRESS);
  const amount = usdcToMonadAtomic(params.budgetUsdc);
  return {
    chainId: MONAD_CHAIN_ID,
    chainIdHex: MONAD_CHAIN_ID_HEX,
    chainName: MONAD_CHAIN_NAME,
    rpcUrl: MONAD_RPC_URL,
    explorer: MONAD_EXPLORER,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    usdc: MONAD_USDC_ADDRESS,
    usdcDecimals: MONAD_USDC_DECIMALS,
    escrow,
    payee,
    escrowId: escrowIdForMission(params.missionId),
    amount: amount.toString(),
    amountUsdc: formatAtomic(amount),
    timeoutSeconds: timeoutFromEnv(env),
    deployed: escrow !== null,
  };
}

export function buildClosePlan(params: {
  missionId: string;
  budgetUsdc: number;
  meteredBytes: bigint;
  pricePerMbUsdc: number;
  env?: Record<string, string | undefined>;
}): MonadClosePlan {
  const deposit = buildDepositPlan(params);
  const depositAtomic = BigInt(deposit.amount);
  const used = usageAtomic({
    meteredBytes: params.meteredBytes,
    pricePerMbUsdc: params.pricePerMbUsdc,
    depositAtomic,
  });
  const refund = depositAtomic - used;
  const typed = deposit.escrow
    ? closeVoucherTypedData({
        escrow: deposit.escrow,
        escrowId: deposit.escrowId,
        cumulativeAmount: used,
      })
    : null;
  return {
    ...deposit,
    cumulativeAmount: used.toString(),
    refundAtomic: refund.toString(),
    usedUsdc: formatAtomic(used),
    refundUsdc: formatAtomic(refund),
    typedData: typed
      ? {
          domain: typed.domain,
          types: typed.types,
          primaryType: "CloseVoucher",
          message: {
            escrowId: typed.message.escrowId,
            cumulativeAmount: used.toString(),
          },
        }
      : null,
  };
}

export function buildTopUpPlan(params: {
  missionId: string;
  amountUsdc: number;
  env?: Record<string, string | undefined>;
}): MonadDepositPlan {
  return buildDepositPlan({
    missionId: params.missionId,
    budgetUsdc: params.amountUsdc,
    env: params.env,
  });
}
