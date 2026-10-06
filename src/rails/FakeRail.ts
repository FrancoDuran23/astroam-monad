// FakeRail: an in-memory PaymentRail for demos and tests. No wallet, no
// network: deposits are accepted on any non-empty transaction hash, each
// mission gets its own channel, and vouchers are signed by the in-memory
// double (deterministic hash, never a real signature). Every value it
// returns is marked as simulated (`isMock`, `isLive: false`).

import { createHash } from "node:crypto";
import { createInMemoryVoucherPort, type VoucherPort } from "../meter/voucher-port.ts";
import { fakeQrDataUri } from "../shared/fake-qr.ts";
import type { Network } from "../shared/network.ts";
import type {
  CloseOutcome,
  DepositConfirmation,
  DepositIntent,
  DepositPurpose,
  PaymentRail,
} from "./PaymentRail.ts";
import { atomicToRaw, rawToAtomicFloor } from "../shared/monad/amounts.ts";

type FakeChannel = {
  depositRaw: bigint;
  highestSignedRaw: bigint;
  claimedAtomic: bigint;
  voucherPort: VoucherPort;
  closed: boolean;
};

type FakeIntent = { missionId: string; amountUsdc: number; purpose: DepositPurpose; channelId?: string };

export type FakeRailOptions = {
  network?: Network;
  /** Address shown as the deposit destination. */
  payTo?: string;
  now?: () => Date;
};

/** USDC (number) to raw units (1e-7 USDC). */
export function usdcToRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1e7));
}

function hex(seed: string, bytes: number): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, bytes * 2);
}

export class FakeRail implements PaymentRail {
  readonly network: Network;
  readonly displayName = "Simulated payments";
  readonly isLive = false;
  readonly voucherSigning = "rail" as const;
  private readonly payTo: string;
  private readonly intents = new Map<string, FakeIntent>();
  private readonly channels = new Map<string, FakeChannel>();
  private readonly now: () => Date;
  private seq = 0;

  constructor(options: FakeRailOptions = {}) {
    this.network = options.network ?? "demo:local";
    this.payTo = options.payTo ?? `0x${hex("astroam-demo-recipient", 20)}`;
    this.now = options.now ?? (() => new Date());
  }

  async createDepositIntent(input: {
    missionId: string;
    amountUsdc: number;
    purpose: DepositPurpose;
    channelId?: string;
  }): Promise<DepositIntent> {
    if (input.purpose === "topup" && (input.channelId === undefined || !this.channels.has(input.channelId))) {
      throw new Error("A top-up needs the mission's open channel");
    }
    const intentId = `intent_demo_${++this.seq}_${hex(`${input.missionId}:${input.purpose}:${this.seq}`, 4)}`;
    this.intents.set(intentId, { ...input });
    const paymentUri = `astroam-demo:pay?to=${this.payTo}&amount=${input.amountUsdc}&asset=USDC&ref=${intentId}`;
    return {
      intentId,
      amountUsdc: input.amountUsdc,
      asset: "USDC",
      payTo: this.payTo,
      paymentUri,
      qr: fakeQrDataUri(paymentUri),
      isMock: true,
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
    if (intent === undefined || intent.missionId !== input.missionId || intent.purpose !== input.purpose) {
      return { valid: false, reason: "unknown_intent" };
    }
    if (input.txHash.trim() === "") return { valid: false, reason: "missing_tx_hash" };
    this.intents.delete(input.intentId);

    const amountRaw = usdcToRaw(intent.amountUsdc);
    if (intent.purpose === "topup") {
      const channel = this.channels.get(intent.channelId!)!;
      channel.depositRaw += amountRaw;
      return { valid: true, txHash: input.txHash, channelId: intent.channelId!, depositRaw: channel.depositRaw };
    }

    // A demo channel id shaped like an EVM contract address.
    const channelId = `0x${hex(`astroam-demo-channel:${intent.missionId}`, 20)}`;
    const channel: FakeChannel = {
      depositRaw: amountRaw,
      highestSignedRaw: 0n,
      claimedAtomic: 0n,
      closed: false,
      voucherPort: undefined as unknown as VoucherPort,
    };
    const inner = createInMemoryVoucherPort({ depositRaw: () => channel.depositRaw, seed: `astroam-demo:${channelId}` });
    channel.voucherPort = {
      async requestVoucher(m1) {
        const m2 = await inner.requestVoucher(m1);
        if (m2.status === "signed") {
          const amount = BigInt(m2.voucher.cumulativeAmount);
          if (amount > channel.highestSignedRaw) channel.highestSignedRaw = amount;
        }
        return m2;
      },
    };
    this.channels.set(channelId, channel);
    return {
      valid: true,
      txHash: input.txHash,
      channelId,
      depositRaw: channel.depositRaw,
      travelerAddress: `0x${hex(`traveler:${intent.missionId}`, 20)}`,
      sessionKey: `0x${hex(`session:${intent.missionId}`, 20)}`,
      escrowActiveAt: this.now().toISOString(),
    };
  }

  async getChannelDepositRaw(channelId: string): Promise<bigint> {
    const channel = this.channels.get(channelId);
    if (channel === undefined) throw new Error(`Unknown demo channel ${channelId}`);
    return channel.depositRaw;
  }

  voucherPortFor(channelId: string): VoucherPort {
    const channel = this.channels.get(channelId);
    if (channel === undefined) throw new Error(`Unknown demo channel ${channelId}`);
    return channel.voucherPort;
  }

  async submitTravelerVoucher(input: {
    channelId: string;
    cumulativeAmount: string;
    signature: string;
  }): Promise<{ accepted: true; authorizedRaw: bigint } | { accepted: false; reason: string }> {
    const channel = this.channels.get(input.channelId);
    if (!channel) return { accepted: false, reason: "channel_not_found" };
    if (channel.closed) return { accepted: false, reason: "channel_closed" };
    const amountAtomic = BigInt(input.cumulativeAmount);
    const amountRaw = atomicToRaw(amountAtomic);
    if (amountRaw > channel.depositRaw) return { accepted: false, reason: "exceeds_deposit" };
    if (amountRaw > channel.highestSignedRaw) {
      channel.highestSignedRaw = amountRaw;
    }
    return { accepted: true, authorizedRaw: channel.highestSignedRaw };
  }

  async getAuthorizedRaw(channelId: string): Promise<bigint> {
    const channel = this.channels.get(channelId);
    if (!channel) return 0n;
    return channel.highestSignedRaw;
  }

  async claim(params: {
    channelId: string;
    voucherAmountAtomic: bigint;
    signature: string;
  }): Promise<{ txHash: string; claimedAtomic: bigint }> {
    const channel = this.channels.get(params.channelId);
    if (channel === undefined) throw new Error(`Unknown demo channel ${params.channelId}`);
    if (channel.closed) throw new Error(`Channel already closed: ${params.channelId}`);
    channel.claimedAtomic = params.voucherAmountAtomic;
    return {
      txHash: "0xmock_claim_" + Date.now(),
      claimedAtomic: params.voucherAmountAtomic,
    };
  }

  async readEscrowState(channelId: string): Promise<{
    depositAtomic: bigint;
    claimedAtomic: bigint;
    settled: boolean;
    activeAt?: number;
  } | null> {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    return {
      depositAtomic: rawToAtomicFloor(channel.depositRaw),
      claimedAtomic: channel.claimedAtomic,
      settled: channel.closed,
      activeAt: Math.floor(this.now().getTime() / 1000),
    };
  }

  getClaimedAtomic(channelId: string): bigint {
    const channel = this.channels.get(channelId);
    if (channel === undefined) throw new Error(`Unknown demo channel ${channelId}`);
    return channel.claimedAtomic;
  }

  async closeChannel(channelId: string, settleRaw?: bigint): Promise<CloseOutcome> {
    const channel = this.channels.get(channelId);
    if (channel === undefined) return { kind: "failed", reason: "channel_not_found", detail: channelId };
    if (channel.closed) return { kind: "failed", reason: "close_error", detail: "channel already closed" };
    if (channel.highestSignedRaw === 0n) {
      channel.closed = true;
      return { kind: "nothing_to_close", detail: "no voucher was ever signed for this channel" };
    }
    channel.closed = true;
    const settled = settleRaw === undefined || settleRaw > channel.highestSignedRaw ? channel.highestSignedRaw : settleRaw;
    return {
      kind: "closed",
      txHash: `demo_close_${hex(`${channelId}:${settled}`, 16)}`,
      settledRaw: settled,
      refundedRaw: channel.depositRaw - settled,
    };
  }

  private payeeBalanceAtomic = 0n;
  private extraPayeeBalanceAtomic = 0n;
  readonly swept = new Map<string, bigint>();

  creditPayeeAtomic(amount: bigint): void {
    this.extraPayeeBalanceAtomic += amount;
  }

  async sweep(input: { to: string; minAtomic: bigint }): Promise<{ txHash: string; amountAtomic: bigint } | null> {
    let balance = this.extraPayeeBalanceAtomic;
    for (const ch of this.channels.values()) {
      balance += ch.claimedAtomic;
    }
    const current = balance - this.payeeBalanceAtomic;
    if (current < input.minAtomic || current === 0n) return null;
    this.payeeBalanceAtomic += current;
    this.swept.set(input.to, (this.swept.get(input.to) ?? 0n) + current);
    return {
      txHash: `0xmock_sweep_${Date.now()}`,
      amountAtomic: current,
    };
  }

  explorerTxUrl(): string | undefined {
    return undefined;
  }
}
