// MonadRail: payments through the AstroAmEscrow contract on Monad.
//
//   deposit  — the traveler's wallet approves USDC and calls deposit(escrowId,
//              amount, sessionKey); confirmDeposit verifies the receipt.
//   vouchers — the traveler's app signs EIP-712 vouchers with the session key
//              for the running total it authorizes; the server keeps the
//              highest valid one and credits data only up to it.
//   close    — AstroAm (the payee) calls close(): it is paid what was used,
//              capped by the highest voucher; the rest is refunded on-chain.

import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VoucherPort } from "../meter/voucher-port.ts";
import { buildUnsigned, message2SignedSchema, type Message2 } from "../shared/messages.ts";
import type { Network } from "../shared/network.ts";
import { astroAmEscrowAbi, erc20Abi } from "../shared/monad/abi.ts";
import { atomicToRaw, rawToAtomicCeil, rawToAtomicFloor, usdcToAtomic } from "../shared/monad/amounts.ts";
import { MONAD_CHAIN_NAME, MONAD_USDC_DECIMALS } from "../shared/monad/constants.ts";
import { monadTxUrl } from "../shared/monad/explorer.ts";
import { escrowIdForMission, recoverVoucherSigner } from "../shared/monad/voucher.ts";
import type {
  CloseOutcome,
  DepositConfirmation,
  DepositIntent,
  DepositPurpose,
  PaymentRail,
} from "./PaymentRail.ts";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const DIGITS_RE = /^(0|[1-9]\d*)$/;

export type MonadRailOptions = {
  rpcUrl: string;
  chainId: number;
  chainName?: string;
  explorer: string;
  network: Network;
  escrow: Address;
  usdc: Address;
  /** Key of the payee: the only account allowed to close. */
  payeePrivateKey: Hex;
  /** Where the highest voucher per channel is kept across restarts. */
  dataDir: string;
  /** How long confirmDeposit waits for a receipt. */
  receiptTimeoutMs?: number;
};

type OnChainEscrow = {
  traveler: Address;
  signer: Address;
  deposit: bigint;
  claimed: bigint;
  settled: boolean;
  openedAt: bigint;
  lastActivityAt: bigint;
};
type StoredVoucher = { atomic: string; signature: Hex; signedAt: string };
type Intent = { missionId: string; purpose: DepositPurpose; escrowId: Hex; amountAtomic: bigint };

/** Highest traveler-signed voucher per channel, persisted as JSON. */
class VoucherBook {
  private readonly file: string;
  private data: Record<string, StoredVoucher>;

  constructor(file: string) {
    this.file = file;
    try {
      this.data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, StoredVoucher>;
    } catch {
      this.data = {};
    }
  }

  get(escrowId: string): { atomic: bigint; signature: Hex; signedAt: string } | undefined {
    const v = this.data[escrowId.toLowerCase()];
    return v ? { atomic: BigInt(v.atomic), signature: v.signature, signedAt: v.signedAt } : undefined;
  }

  put(escrowId: string, atomic: bigint, signature: Hex): void {
    this.data[escrowId.toLowerCase()] = { atomic: atomic.toString(), signature, signedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export class MonadRail implements PaymentRail {
  readonly network: Network;
  readonly displayName: string;
  readonly isLive = true;
  readonly voucherSigning = "traveler" as const;

  private readonly opts: MonadRailOptions;
  private readonly client: PublicClient;
  private readonly wallet;
  private readonly account;
  private readonly book: VoucherBook;
  private readonly intents = new Map<string, Intent>();
  private readonly usedTxs = new Set<string>();
  private seq = 0;

  constructor(opts: MonadRailOptions) {
    this.opts = opts;
    this.network = opts.network;
    this.displayName = opts.chainName ?? MONAD_CHAIN_NAME;
    const chain = defineChain({
      id: opts.chainId,
      name: this.displayName,
      nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [opts.rpcUrl] } },
    });
    this.client = createPublicClient({ chain, transport: http(opts.rpcUrl) }) as PublicClient;
    this.account = privateKeyToAccount(opts.payeePrivateKey);
    this.wallet = createWalletClient({ account: this.account, chain, transport: http(opts.rpcUrl) });
    this.book = new VoucherBook(path.join(opts.dataDir, `monad-vouchers-${opts.escrow.toLowerCase()}.json`));
  }

  private async readEscrow(escrowId: Hex): Promise<OnChainEscrow> {
    const [traveler, openedAt, settled, signer, deposit, claimed, lastActivityAt] = (await this.client.readContract({
      address: this.opts.escrow,
      abi: astroAmEscrowAbi,
      functionName: "escrows",
      args: [escrowId],
    })) as readonly [Address, bigint, boolean, Address, bigint, bigint, bigint];
    return { traveler, signer, settled, deposit, claimed, openedAt, lastActivityAt };
  }

  async createDepositIntent(input: {
    missionId: string;
    amountUsdc: number;
    purpose: DepositPurpose;
    channelId?: string;
  }): Promise<DepositIntent> {
    if (input.purpose === "topup" && (!input.channelId || !BYTES32_RE.test(input.channelId))) {
      throw new Error("A top-up needs the mission's open channel");
    }
    const escrowId = (input.purpose === "mission" ? escrowIdForMission(input.missionId) : input.channelId) as Hex;
    const amountAtomic = usdcToAtomic(input.amountUsdc);
    if (amountAtomic === 0n) throw new Error("The deposit must be greater than zero");
    const intentId = `monad_${escrowId.slice(2, 10)}_${input.purpose}_${++this.seq}`;
    this.intents.set(intentId, { missionId: input.missionId, purpose: input.purpose, escrowId, amountAtomic });

    return {
      intentId,
      amountUsdc: input.amountUsdc,
      asset: "USDC",
      payTo: this.opts.escrow,
      isMock: false,
      evm: {
        kind: "evm",
        chainId: this.opts.chainId,
        chainName: this.displayName,
        rpcUrl: this.opts.rpcUrl,
        explorer: this.opts.explorer,
        token: this.opts.usdc,
        tokenDecimals: MONAD_USDC_DECIMALS,
        contract: this.opts.escrow,
        escrowId,
        amountAtomic: amountAtomic.toString(),
        method: input.purpose === "mission" ? "deposit" : "topUp",
      },
    };
  }

  async confirmDeposit(input: {
    missionId: string;
    intentId: string;
    txHash: string;
    purpose: DepositPurpose;
    channelId?: string;
  }): Promise<DepositConfirmation> {
    const intent = this.intents.get(input.intentId);
    if (!intent || intent.missionId !== input.missionId || intent.purpose !== input.purpose) {
      return { valid: false, reason: "unknown_intent" };
    }
    if (!TX_HASH_RE.test(input.txHash)) return { valid: false, reason: "invalid_tx_hash" };
    const hash = input.txHash.toLowerCase() as Hex;
    if (this.usedTxs.has(hash)) return { valid: false, reason: "tx_already_used" };

    let receipt;
    try {
      receipt = await this.client.waitForTransactionReceipt({ hash, timeout: this.opts.receiptTimeoutMs ?? 60_000 });
    } catch {
      return { valid: false, reason: "tx_not_found" };
    }
    if (receipt.status !== "success") return { valid: false, reason: "tx_reverted" };

    const logs = parseEventLogs({
      abi: astroAmEscrowAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === this.opts.escrow.toLowerCase()),
    });
    const matched = logs.some((log) => {
      const args = log.args as { escrowId?: Hex; amount?: bigint; added?: bigint };
      if (args.escrowId?.toLowerCase() !== intent.escrowId.toLowerCase()) return false;
      return intent.purpose === "mission"
        ? log.eventName === "Deposited" && args.amount === intent.amountAtomic
        : log.eventName === "ToppedUp" && args.added === intent.amountAtomic;
    });
    if (!matched) return { valid: false, reason: "deposit_not_in_tx" };

    const escrow = await this.readEscrow(intent.escrowId);
    this.usedTxs.add(hash);
    this.intents.delete(input.intentId);
    return {
      valid: true,
      txHash: input.txHash,
      explorerUrl: this.explorerTxUrl(input.txHash),
      channelId: intent.escrowId,
      depositRaw: atomicToRaw(escrow.deposit),
      travelerAddress: escrow.traveler,
      sessionKey: escrow.signer,
      escrowActiveAt: new Date(Number(escrow.lastActivityAt) * 1000).toISOString(),
    };
  }

  async getChannelDepositRaw(channelId: string): Promise<bigint> {
    return atomicToRaw((await this.readEscrow(channelId as Hex)).deposit);
  }

  async getAuthorizedRaw(channelId: string): Promise<bigint> {
    return atomicToRaw(this.book.get(channelId)?.atomic ?? 0n);
  }

  async submitTravelerVoucher(input: {
    channelId: string;
    cumulativeAmount: string;
    signature: string;
  }): Promise<{ accepted: true; authorizedRaw: bigint } | { accepted: false; reason: string }> {
    if (!BYTES32_RE.test(input.channelId)) return { accepted: false, reason: "invalid_channel" };
    if (!DIGITS_RE.test(input.cumulativeAmount)) return { accepted: false, reason: "invalid_amount" };
    if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return { accepted: false, reason: "invalid_signature" };
    const escrowId = input.channelId as Hex;
    const amount = BigInt(input.cumulativeAmount);
    const escrow = await this.readEscrow(escrowId);
    if (escrow.traveler === "0x0000000000000000000000000000000000000000") return { accepted: false, reason: "channel_not_found" };
    if (escrow.settled) return { accepted: false, reason: "channel_closed" };
    if (amount > escrow.deposit) return { accepted: false, reason: "exceeds_deposit" };

    const signer = await recoverVoucherSigner({
      chainId: this.opts.chainId,
      escrow: this.opts.escrow,
      escrowId,
      cumulativeAmount: amount,
      signature: input.signature as Hex,
    });
    if (signer !== getAddress(escrow.signer) && signer !== getAddress(escrow.traveler)) {
      return { accepted: false, reason: "bad_signature" };
    }

    const current = this.book.get(escrowId);
    if (!current || amount > current.atomic) this.book.put(escrowId, amount, input.signature as Hex);
    return { accepted: true, authorizedRaw: atomicToRaw(this.book.get(escrowId)!.atomic) };
  }

  voucherPortFor(channelId: string): VoucherPort {
    const escrowId = channelId as Hex;
    let lastReturned: bigint | undefined;
    return {
      requestVoucher: async (m1): Promise<Message2> => {
        const need = rawToAtomicCeil(BigInt(m1.cumulativeAmount));
        const escrow = await this.readEscrow(escrowId);
        const held = this.book.get(escrowId);
        const remainingRaw = atomicToRaw(escrow.deposit - (held?.atomic ?? 0n));
        const base = { sessionId: m1.sessionId, channel: channelId, meterReadingId: m1.meterReadingId, remaining: remainingRaw.toString() };
        if (escrow.settled) return buildUnsigned("channel_closing", { ...base, detail: "the channel is already settled" }).body;
        if (need > escrow.deposit) {
          return buildUnsigned("channel_exhausted", { ...base, detail: `reading needs ${need} but the deposit is ${escrow.deposit}` }).body;
        }
        if (!held || held.atomic < need) {
          return buildUnsigned("authorization_required", {
            ...base,
            detail: `reading needs ${need}; the traveler authorized ${held?.atomic ?? 0n}`,
          }).body;
        }
        const reused = lastReturned === held.atomic;
        lastReturned = held.atomic;
        return message2SignedSchema.parse({
          version: 1,
          status: "signed",
          sessionId: m1.sessionId,
          channel: channelId,
          voucher: {
            cumulativeAmount: atomicToRaw(held.atomic).toString(),
            signature: held.signature,
            commitmentPubkey: escrow.signer,
            network: m1.network,
          },
          meterReadingId: m1.meterReadingId,
          reused,
          remaining: remainingRaw.toString(),
          signedAt: held.signedAt,
        });
      },
    };
  }

  async claim(params: {
    channelId: string;
    voucherAmountAtomic: bigint;
    signature: string;
  }): Promise<{ txHash: string; claimedAtomic: bigint }> {
    const formattedChannelId = params.channelId.startsWith("0x")
      ? params.channelId
      : `0x${params.channelId}`;
    if (!BYTES32_RE.test(formattedChannelId)) {
      throw new Error(`Invalid channelId: expected bytes32 hex string, got ${params.channelId}`);
    }
    const escrowId = formattedChannelId as Hex;
    const signature = (params.signature.startsWith("0x")
      ? params.signature
      : `0x${params.signature}`) as Hex;

    const { request } = await this.client.simulateContract({
      account: this.account,
      address: this.opts.escrow,
      abi: astroAmEscrowAbi,
      functionName: "claim",
      args: [escrowId, params.voucherAmountAtomic, signature],
    });
    const hash = await this.wallet.writeContract(request);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`claim reverted: ${hash}`);
    }

    return {
      txHash: (receipt as { hash?: string }).hash ?? receipt.transactionHash ?? hash,
      claimedAtomic: params.voucherAmountAtomic,
    };
  }

  async readEscrowState(channelId: string): Promise<{
    depositAtomic: bigint;
    claimedAtomic: bigint;
    settled: boolean;
    activeAt?: number;
  } | null> {
    const formattedChannelId = channelId.startsWith("0x") ? channelId : `0x${channelId}`;
    if (!BYTES32_RE.test(formattedChannelId)) return null;
    try {
      const escrow = await this.readEscrow(formattedChannelId as Hex);
      return {
        depositAtomic: escrow.deposit,
        claimedAtomic: escrow.claimed,
        settled: escrow.settled,
        activeAt: Number(escrow.lastActivityAt),
      };
    } catch {
      return null;
    }
  }

  async closeChannel(channelId: string, settleRaw?: bigint): Promise<CloseOutcome> {
    const escrowId = channelId as Hex;
    let escrow: OnChainEscrow;
    try {
      escrow = await this.readEscrow(escrowId);
    } catch (error) {
      return { kind: "failed", reason: "upstream_unavailable", detail: String(error) };
    }
    if (escrow.traveler === "0x0000000000000000000000000000000000000000") {
      return { kind: "failed", reason: "channel_not_found", detail: channelId };
    }
    if (escrow.settled) return { kind: "failed", reason: "close_error", detail: "the channel is already settled" };

    const held = this.book.get(escrowId);
    const voucherAtomic = held?.atomic ?? 0n;
    const wanted = settleRaw === undefined ? voucherAtomic : rawToAtomicFloor(settleRaw);
    const settleAtomic = wanted > voucherAtomic ? voucherAtomic : wanted;
    const args = settleAtomic === 0n
      ? ([escrowId, 0n, "0x", 0n] as const)
      : ([escrowId, voucherAtomic, held!.signature, settleAtomic] as const);

    try {
      const { request } = await this.client.simulateContract({
        account: this.account,
        address: this.opts.escrow,
        abi: astroAmEscrowAbi,
        functionName: "close",
        args,
      });
      const hash = await this.wallet.writeContract(request);
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return { kind: "failed", reason: "close_error", detail: `close reverted: ${hash}` };
      const closed = parseEventLogs({ abi: astroAmEscrowAbi, logs: receipt.logs, eventName: "Closed" })[0];
      const { paid, refunded } = (closed?.args ?? { paid: settleAtomic, refunded: escrow.deposit - settleAtomic }) as {
        paid: bigint;
        refunded: bigint;
      };
      return {
        kind: "closed",
        txHash: hash,
        explorerUrl: this.explorerTxUrl(hash),
        settledRaw: atomicToRaw(paid),
        refundedRaw: atomicToRaw(refunded),
      };
    } catch (error) {
      return { kind: "failed", reason: "close_error", detail: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
    }
  }

  async sweep(input: { to: string; minAtomic: bigint }): Promise<{ txHash: string; amountAtomic: bigint } | null> {
    if (!isAddress(input.to)) {
      throw new Error(`Invalid treasury address: ${input.to}`);
    }
    const toAddress = getAddress(input.to);
    const balance = (await this.client.readContract({
      address: this.opts.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.account.address],
    })) as bigint;

    if (balance === 0n || balance < input.minAtomic) return null;

    const { request } = await this.client.simulateContract({
      account: this.account,
      address: this.opts.usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [toAddress, balance],
    });
    const hash = await this.wallet.writeContract(request);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`sweep reverted: ${hash}`);
    }
    return {
      txHash: (receipt as { hash?: string }).hash ?? receipt.transactionHash ?? hash,
      amountAtomic: balance,
    };
  }

  explorerTxUrl(txHash: string): string | undefined {
    return monadTxUrl(txHash, this.opts.explorer);
  }
}

/** Builds the Monad rail from the environment, failing fast with the variable to fix. */
export function monadRailFromEnv(env: Record<string, string | undefined>, defaults: {
  rpcUrl: string;
  chainId: number;
  explorer: string;
  usdc: string;
  network: Network;
}): MonadRail {
  const escrow = env.MONAD_ESCROW_ADDRESS?.trim();
  const key = env.MONAD_PAYEE_PRIVATE_KEY?.trim();
  const usdc = env.MONAD_USDC_ADDRESS?.trim() || defaults.usdc;
  if (!escrow || !isAddress(escrow)) {
    throw new Error("PAYMENT_RAIL=monad needs MONAD_ESCROW_ADDRESS (deploy with `npm run monad:deploy`)");
  }
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("PAYMENT_RAIL=monad needs MONAD_PAYEE_PRIVATE_KEY (the payee account that closes channels)");
  }
  if (!isAddress(usdc)) throw new Error("MONAD_USDC_ADDRESS is not an address");
  return new MonadRail({
    rpcUrl: env.MONAD_RPC_URL?.trim() || defaults.rpcUrl,
    chainId: Number(env.MONAD_CHAIN_ID) || defaults.chainId,
    explorer: env.MONAD_EXPLORER_URL?.trim() || defaults.explorer,
    network: defaults.network,
    escrow: getAddress(escrow),
    usdc: getAddress(usdc),
    payeePrivateKey: key as Hex,
    dataDir: env.DATA_DIR || "./data",
  });
}
