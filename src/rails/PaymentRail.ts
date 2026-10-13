// PaymentRail: everything chain-specific about paying for a mission sits
// behind this port. The product (src/product), the meter and the policy only
// talk to it, so the same app runs on any chain that implements it.
//
// Lifecycle of one mission's money:
//   1. createDepositIntent  — what the traveler's wallet has to sign: on an
//      EVM chain, `deposit()` on the escrow contract with the USDC deposit.
//   2. confirmDeposit       — verifies that transaction against the chain and
//      returns the payment channel it opened (or topped up). The rail keeps
//      no memory of the intent: the channel comes from the mission.
//   3. voucherPortFor       — signs cumulative vouchers against that channel
//      while the meter reads usage; nothing goes on-chain per MB.
//   4. closeChannel         — settles the highest voucher in one transaction
//      and refunds the rest of the deposit to the traveler.
//
// The rail never holds what it collects: on Monad the contract pays the payee
// directly, and the rail's key only sends the transactions.
//
// Amounts are in the internal raw unit (1 raw = 1e-7 USDC); each rail
// converts to its token's decimals.

import type { VoucherPort } from "../meter/voucher-port.ts";
import type { Network } from "../shared/network.ts";

export type DepositPurpose = "mission" | "topup";

/** What an EVM wallet must send to make the deposit (approve + deposit/topUp). */
export type EvmDepositPlan = {
  kind: "evm";
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string;
  /** USDC contract and its decimals. */
  token: string;
  tokenDecimals: number;
  /** The escrow (payment channel) contract. */
  contract: string;
  /** bytes32 id of this mission's channel inside the contract. */
  escrowId: string;
  /** Amount in token units, as a decimal string. */
  amountAtomic: string;
  method: "deposit" | "topUp";
};

export type DepositIntent = {
  /** A label for this request. Nothing depends on the rail remembering it. */
  intentId: string;
  /** What the traveler pays, in USDC. */
  amountUsdc: number;
  asset: "USDC";
  /** Address the deposit goes to (the channel contract, a program, …). */
  payTo: string;
  /** Wallet deep link for the deposit, when the chain has a standard one. */
  paymentUri?: string;
  /** QR image (data: URI) of `paymentUri`, for paying from another device. */
  qr?: string;
  /** true when no real chain is behind the intent (FakeRail). */
  isMock: boolean;
  /** Present when the traveler's wallet sends the deposit itself. */
  evm?: EvmDepositPlan;
};

export type DepositConfirmation =
  | {
      valid: true;
      txHash: string;
      explorerUrl?: string;
      /** The channel this deposit opened or topped up. */
      channelId: string;
      /** Total the channel holds as deposit now, as the chain reports it. */
      depositRaw: bigint;
      /** What this transaction itself added to the channel. */
      amountRaw: bigint;
      travelerAddress?: string;
      sessionKey?: string;
      escrowActiveAt?: string;
    }
  | { valid: false; reason: string };

export type CloseOutcome =
  | { kind: "closed"; txHash: string; explorerUrl?: string; settledRaw: bigint; refundedRaw: bigint }
  /** The close transaction landed but the settlement could not be verified. */
  | { kind: "closed_unverified"; txHash: string; explorerUrl?: string; settledRaw: bigint }
  /** No voucher was ever accepted for this channel: nothing to settle. */
  | { kind: "nothing_to_close"; detail: string }
  | { kind: "blocked"; reason: string; detail: string }
  | {
      kind: "failed";
      reason: "channel_not_found" | "refund_not_received" | "close_error" | "upstream_unavailable" | "channel_mismatch";
      detail: string;
    };

/** Whether the rail's own key is allowed to collect and close. */
export type OperatorCheck =
  | { authorized: true; account: string; operator: string; payee: string }
  | {
      authorized: false;
      account: string;
      /** "operator_not_authorized": the key is neither the operator nor the payee. */
      reason: "operator_not_authorized" | "upstream_unavailable";
      detail: string;
    };

export interface PaymentRail {
  /** `<chain>:<name>`, carried in every voucher request (M1). */
  readonly network: Network;
  /** Human name for the UI and logs, e.g. "Monad testnet". */
  readonly displayName: string;
  /** false when payments are simulated (FakeRail). */
  readonly isLive: boolean;
  /**
   * Who signs the vouchers: the rail itself ("rail", FakeRail), or the
   * traveler's app with a session key registered at deposit ("traveler").
   * With "traveler", data is credited only up to what the app authorized.
   */
  readonly voucherSigning: "rail" | "traveler";

  createDepositIntent(input: {
    missionId: string;
    amountUsdc: number;
    purpose: DepositPurpose;
    /** Required for a top-up: the channel to add funds to. */
    channelId?: string;
  }): Promise<DepositIntent>;

  /**
   * Verifies a deposit against the chain alone, so it works after a restart.
   * A mission deposit must have gone into the mission's own channel, which
   * the rail derives from `missionId`; a top-up into `channelId`, which the
   * caller takes from the mission record. What is credited is what the chain
   * holds, never a figure from the request.
   *
   * The same transaction verifies as valid every time it is asked. Crediting
   * it once is the caller's job: it records the transaction with the mission.
   */
  confirmDeposit(input: {
    missionId: string;
    txHash: string;
    purpose: DepositPurpose;
    /** Required for a top-up: the mission's channel. */
    channelId?: string;
    /**
     * What the mission record expects this deposit to be. A rail with a real
     * chain ignores it. The simulated rail has no wallet behind it, so this is
     * what its stand-in wallet pays the first time it sees the transaction.
     */
    amountUsdc?: number;
  }): Promise<DepositConfirmation>;

  /** Total deposited into the channel: the policy's balance base. */
  getChannelDepositRaw(channelId: string): Promise<bigint>;

  /** Signs cumulative vouchers for this channel (the meter's POST /vouchers). */
  voucherPortFor(channelId: string): VoucherPort;

  /**
   * A voucher the traveler's app signed for the running total it authorizes
   * (voucherSigning "traveler"). `cumulativeAmount` is in token units, as
   * signed. Keeps the highest valid one.
   */
  submitTravelerVoucher?(input: {
    channelId: string;
    cumulativeAmount: string;
    signature: string;
  }): Promise<{ accepted: true; authorizedRaw: bigint } | { accepted: false; reason: string }>;

  /** Highest amount the traveler has authorized so far, in raw units. */
  getAuthorizedRaw?(channelId: string): Promise<bigint>;

  /**
   * Collects usage from an open escrow and keeps it open. The voucher
   * (`voucherAmountAtomic`, `signature`) is the most the traveler authorized;
   * `claimTotalAtomic` is the running total the payee will have been paid
   * after the call: what was used so far, above what was already claimed and
   * never above the voucher. The rest of the voucher stays claimable.
   */
  claim?(params: {
    channelId: string;
    voucherAmountAtomic: bigint;
    signature: string;
    claimTotalAtomic: bigint;
  }): Promise<{ txHash: string; claimedAtomic: bigint }>;

  /**
   * Reads the on-chain escrow state if available.
   */
  readEscrowState?(channelId: string): Promise<{
    depositAtomic: bigint;
    claimedAtomic: bigint;
    settled: boolean;
    activeAt?: number;
  } | null>;

  /**
   * The escrow's refund timeout, in seconds: how long after the last deposit,
   * top-up or claim the traveler may take the unclaimed deposit back. It is
   * fixed when the contract is deployed. Rejects when it cannot be read; the
   * caller must not guess a value.
   */
  readTimeoutSeconds?(): Promise<number>;

  /**
   * Settles the channel once. `settleRaw` is what was actually used; the rail
   * pays at most that (and never more than the highest voucher) and refunds
   * the rest. Without it, the highest voucher is settled.
   */
  closeChannel(channelId: string, settleRaw?: bigint): Promise<CloseOutcome>;

  /**
   * Checks that the rail's own key may send `claim` and `close`. Absent when
   * the rail has no key of its own (FakeRail).
   */
  checkOperator?(): Promise<OperatorCheck>;

  /** Block-explorer link for a transaction, when there is a real chain. */
  explorerTxUrl(txHash: string): string | undefined;
}
