// FakeRail: an in-memory PaymentRail for demos and tests. No wallet, no
// network. It stands in for two things:
//
//   - the chain. `FakeEscrow` keeps the rules of contracts/src/AstroAmEscrow.sol
//     that the backend relies on and reverts with the contract's own error
//     names, so a test on the fake cannot pass for something the contract
//     rejects. A transaction hash names one transaction for good: asked
//     again, it is the same deposit into the same escrow, never a new one.
//   - the traveler's wallet and app. The wallet "sends" a deposit the first
//     time its transaction hash is confirmed, and each mission has a session
//     key that signs real EIP-712 vouchers (`signVoucher`).
//
// The rail itself drives the fake contract the way MonadRail drives the real
// one. Every value it returns is marked as simulated (`isMock`,
// `isLive: false`).

import { createHash, randomBytes } from "node:crypto";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VoucherPort } from "../meter/voucher-port.ts";
import { fakeQrDataUri } from "../shared/fake-qr.ts";
import { buildUnsigned, message2SignedSchema, type Message2 } from "../shared/messages.ts";
import type { Network } from "../shared/network.ts";
import { atomicToRaw, rawToAtomicCeil, rawToAtomicFloor, usdcToAtomic } from "../shared/monad/amounts.ts";
import { escrowIdForMission, recoverVoucherSigner, voucherDomain, VOUCHER_TYPES } from "../shared/monad/voucher.ts";
import type {
  CloseOutcome,
  DepositConfirmation,
  DepositIntent,
  DepositPurpose,
  PaymentRail,
} from "./PaymentRail.ts";

const DIGITS_RE = /^(0|[1-9]\d*)$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;
/** Chain id of the simulated contract's EIP-712 domain (the local-chain id). */
const FAKE_CHAIN_ID = 31337;

export type FakeRailOptions = {
  network?: Network;
  /**
   * Address shown as the deposit destination: the simulated escrow contract,
   * and so the verifying contract of its vouchers.
   */
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A revert of the simulated contract, named like the Solidity custom error. */
export class EscrowRevert extends Error {
  readonly errorName: string;

  constructor(errorName: string) {
    super(`${errorName}()`);
    this.name = "EscrowRevert";
    this.errorName = errorName;
  }
}

export type FakeEscrowState = {
  traveler: Address;
  /** Session key that signs vouchers for this escrow. */
  signer: Address;
  deposit: bigint;
  claimed: bigint;
  settled: boolean;
  /** Last deposit, top-up or claim, in seconds. */
  lastActivityAt: number;
};

/**
 * The part of AstroAmEscrow the backend depends on, in memory and in USDC
 * atomic units. Same checks in the same order as the contract; who may call
 * `claim` and `close` and the timeout refund are left out.
 */
export class FakeEscrow {
  readonly chainId: number;
  readonly address: Address;
  /** USDC paid to the payee by `claim` and `close`, atomic units. */
  payeeBalance = 0n;
  /** USDC sent back to each traveler by `close`, atomic units. */
  readonly refunded = new Map<string, bigint>();
  private readonly escrows = new Map<string, FakeEscrowState>();
  private readonly now: () => Date;

  constructor(chainId: number, address: Address, now: () => Date = () => new Date()) {
    this.chainId = chainId;
    this.address = address;
    this.now = now;
  }

  private seconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }

  /** The `escrows` getter: a copy, or undefined when nothing was deposited. */
  read(escrowId: string): FakeEscrowState | undefined {
    const escrow = this.escrows.get(escrowId.toLowerCase());
    return escrow ? { ...escrow } : undefined;
  }

  private open(escrowId: string): FakeEscrowState {
    const escrow = this.escrows.get(escrowId.toLowerCase());
    if (!escrow) throw new EscrowRevert("EscrowMissing");
    if (escrow.settled) throw new EscrowRevert("AlreadySettled");
    return escrow;
  }

  /** Reverts unless the session key or the traveler signed `voucherAmount` and the deposit covers it. */
  private async checkVoucher(escrow: FakeEscrowState, escrowId: string, voucherAmount: bigint, signature: string): Promise<void> {
    if (voucherAmount > escrow.deposit) throw new EscrowRevert("AmountExceedsDeposit");
    let recovered: Address;
    try {
      recovered = await recoverVoucherSigner({
        chainId: this.chainId,
        escrow: this.address,
        escrowId: escrowId as Hex,
        cumulativeAmount: voucherAmount,
        signature: signature as Hex,
      });
    } catch {
      throw new EscrowRevert("BadVoucher");
    }
    if (recovered !== escrow.signer && recovered !== escrow.traveler) throw new EscrowRevert("BadVoucher");
  }

  deposit(escrowId: string, amount: bigint, traveler: Address, signer: Address): void {
    if (amount === 0n) throw new EscrowRevert("ZeroAmount");
    if (this.escrows.has(escrowId.toLowerCase())) throw new EscrowRevert("EscrowExists");
    this.escrows.set(escrowId.toLowerCase(), {
      traveler: getAddress(traveler),
      signer: getAddress(signer),
      deposit: amount,
      claimed: 0n,
      settled: false,
      lastActivityAt: this.seconds(),
    });
  }

  topUp(escrowId: string, amount: bigint, sender: Address): void {
    if (amount === 0n) throw new EscrowRevert("ZeroAmount");
    const escrow = this.open(escrowId);
    if (getAddress(sender) !== escrow.traveler) throw new EscrowRevert("NotTraveler");
    escrow.deposit += amount;
    escrow.lastActivityAt = this.seconds();
  }

  /**
   * Pays the payee up to `claimTotal` in all: above what was claimed, never
   * above `voucherAmount`. Returns the part paid now.
   */
  async claim(escrowId: string, voucherAmount: bigint, signature: string, claimTotal: bigint): Promise<bigint> {
    const escrow = this.open(escrowId);
    await this.checkVoucher(escrow, escrowId, voucherAmount, signature);
    if (claimTotal > voucherAmount) throw new EscrowRevert("ClaimExceedsVoucher");
    if (claimTotal <= escrow.claimed) throw new EscrowRevert("NothingToClaim");
    const amount = claimTotal - escrow.claimed;
    escrow.claimed = claimTotal;
    escrow.lastActivityAt = this.seconds();
    this.payeeBalance += amount;
    return amount;
  }

  /** Settles once. `paid` is the payee's total for this escrow, earlier claims included. */
  async close(
    escrowId: string,
    voucherAmount: bigint,
    signature: string,
    settleAmount: bigint,
  ): Promise<{ paid: bigint; refunded: bigint }> {
    const escrow = this.open(escrowId);
    if (voucherAmount > escrow.deposit) throw new EscrowRevert("AmountExceedsDeposit");
    if (settleAmount > voucherAmount) throw new EscrowRevert("SettleExceedsVoucher");
    if (settleAmount < escrow.claimed) throw new EscrowRevert("SettleBelowClaimed");
    if (settleAmount > escrow.claimed) await this.checkVoucher(escrow, escrowId, voucherAmount, signature);

    const refunded = escrow.deposit - settleAmount;
    this.payeeBalance += settleAmount - escrow.claimed;
    this.refunded.set(escrow.traveler, (this.refunded.get(escrow.traveler) ?? 0n) + refunded);
    escrow.settled = true;
    return { paid: settleAmount, refunded };
  }
}

/** What the fake chain remembers of a transaction it was shown. */
type FakeTx =
  | { reverted: false; event: "Deposited" | "ToppedUp"; escrowId: string; amountAtomic: bigint }
  | { reverted: true; detail: string };

type HeldVoucher = { atomic: bigint; signature: Hex; signedAt: string };

export class FakeRail implements PaymentRail {
  readonly network: Network;
  readonly displayName = "Simulated payments";
  readonly isLive = false;
  readonly voucherSigning = "rail" as const;
  /** The simulated contract. Tests read its balances and can drive it directly. */
  readonly escrow: FakeEscrow;
  private readonly payTo: Address;
  /** Every transaction the fake chain has seen, by hash. */
  private readonly txs = new Map<string, FakeTx>();
  /** Highest voucher held per channel, as MonadRail keeps it. */
  private readonly vouchers = new Map<string, HeldVoucher>();
  /** The session key the traveler's app would hold, per channel. */
  private readonly sessionKeys = new Map<string, Hex>();
  private readonly now: () => Date;
  private seq = 0;

  constructor(options: FakeRailOptions = {}) {
    this.network = options.network ?? "demo:local";
    this.payTo = (options.payTo ?? `0x${hex("astroam-demo-recipient", 20)}`) as Address;
    this.now = options.now ?? (() => new Date());
    this.escrow = new FakeEscrow(FAKE_CHAIN_ID, this.payTo, this.now);
  }

  /**
   * Test seam: the voucher the traveler's app would sign with this channel's
   * session key for a running total, in USDC atomic units.
   */
  async signVoucher(channelId: string, cumulativeAtomic: bigint): Promise<Hex> {
    const key = this.sessionKeys.get(channelId.toLowerCase());
    if (key === undefined) throw new Error(`Unknown demo channel ${channelId}`);
    return privateKeyToAccount(key).signTypedData({
      domain: voucherDomain(this.escrow.chainId, this.escrow.address),
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { escrowId: channelId as Hex, cumulativeAmount: cumulativeAtomic },
    });
  }

  async createDepositIntent(input: {
    missionId: string;
    amountUsdc: number;
    purpose: DepositPurpose;
    channelId?: string;
  }): Promise<DepositIntent> {
    const escrowId = escrowIdForMission(input.missionId);
    if (input.purpose === "topup" && (input.channelId?.toLowerCase() !== escrowId || !this.escrow.read(escrowId))) {
      throw new Error("A top-up needs the mission's open channel");
    }
    // A label only: nothing is kept under it.
    const intentId = `intent_demo_${randomBytes(6).toString("hex")}`;
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

  /** The stand-in wallet sends the deposit or top-up; a revert of the contract is a reverted transaction. */
  private send(missionId: string, escrowId: string, purpose: DepositPurpose, amountUsdc: number): FakeTx {
    try {
      const amountAtomic = usdcToAtomic(amountUsdc);
      if (purpose === "mission") {
        // Throwaway keys of the simulation, derived from the mission id.
        const sessionKey = keccak256(toBytes(`astroam-demo-session:${missionId}`));
        const traveler = getAddress(`0x${hex(`traveler:${missionId}`, 20)}`);
        this.escrow.deposit(escrowId, amountAtomic, traveler, privateKeyToAccount(sessionKey).address);
        this.sessionKeys.set(escrowId, sessionKey);
        return { reverted: false, event: "Deposited", escrowId, amountAtomic };
      }
      const traveler = this.escrow.read(escrowId)?.traveler;
      if (traveler === undefined) throw new EscrowRevert("EscrowMissing");
      this.escrow.topUp(escrowId, amountAtomic, traveler);
      return { reverted: false, event: "ToppedUp", escrowId, amountAtomic };
    } catch (error) {
      return { reverted: true, detail: messageOf(error) };
    }
  }

  async confirmDeposit(input: {
    missionId: string;
    txHash: string;
    purpose: DepositPurpose;
    channelId?: string;
    amountUsdc?: number;
  }): Promise<DepositConfirmation> {
    const escrowId = escrowIdForMission(input.missionId);
    if (input.purpose === "topup" && input.channelId?.toLowerCase() !== escrowId) {
      return { valid: false, reason: "channel_mismatch" };
    }
    const hash = input.txHash.trim().toLowerCase();
    if (hash === "") return { valid: false, reason: "missing_tx_hash" };

    let tx = this.txs.get(hash);
    if (tx === undefined) {
      // A hash the chain has not seen: the wallet sends that transaction now.
      if (input.amountUsdc === undefined) return { valid: false, reason: "tx_not_found" };
      tx = this.send(input.missionId, escrowId, input.purpose, input.amountUsdc);
      this.txs.set(hash, tx);
    }
    if (tx.reverted) return { valid: false, reason: "tx_reverted" };
    const wanted = input.purpose === "mission" ? "Deposited" : "ToppedUp";
    if (tx.event !== wanted || tx.escrowId !== escrowId) return { valid: false, reason: "deposit_not_in_tx" };

    const escrow = this.escrow.read(escrowId)!;
    if (escrow.settled) return { valid: false, reason: "channel_closed" };
    return {
      valid: true,
      txHash: input.txHash,
      channelId: escrowId,
      depositRaw: atomicToRaw(escrow.deposit),
      amountRaw: atomicToRaw(tx.amountAtomic),
      travelerAddress: escrow.traveler,
      sessionKey: escrow.signer,
      escrowActiveAt: new Date(escrow.lastActivityAt * 1000).toISOString(),
    };
  }

  private channel(channelId: string): FakeEscrowState {
    const escrow = this.escrow.read(channelId);
    if (escrow === undefined) throw new Error(`Unknown demo channel ${channelId}`);
    return escrow;
  }

  async getChannelDepositRaw(channelId: string): Promise<bigint> {
    return atomicToRaw(this.channel(channelId).deposit);
  }

  /**
   * Vouchers for the meter. With `voucherSigning: "rail"` the fake is also
   * the traveler's app: a reading the held voucher does not cover is signed
   * on the spot with the session key, as long as the deposit pays for it.
   */
  voucherPortFor(channelId: string): VoucherPort {
    this.channel(channelId);
    const key = channelId.toLowerCase();
    let lastReturned: bigint | undefined;
    return {
      requestVoucher: async (m1): Promise<Message2> => {
        const need = rawToAtomicCeil(BigInt(m1.cumulativeAmount));
        const escrow = this.channel(channelId);
        let held = this.vouchers.get(key);
        const remaining = () => atomicToRaw(escrow.deposit - (held?.atomic ?? 0n)).toString();
        const base = { sessionId: m1.sessionId, channel: channelId, meterReadingId: m1.meterReadingId };
        if (escrow.settled) {
          return buildUnsigned("channel_closing", { ...base, remaining: remaining(), detail: "the channel is already settled" }).body;
        }
        if (need > escrow.deposit) {
          return buildUnsigned("channel_exhausted", {
            ...base,
            remaining: remaining(),
            detail: `reading needs ${need} but the deposit is ${escrow.deposit}`,
          }).body;
        }
        if (!held || held.atomic < need) {
          held = { atomic: need, signature: await this.signVoucher(channelId, need), signedAt: this.now().toISOString() };
          this.vouchers.set(key, held);
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
          remaining: remaining(),
          signedAt: held.signedAt,
        });
      },
    };
  }

  async submitTravelerVoucher(input: {
    channelId: string;
    cumulativeAmount: string;
    signature: string;
  }): Promise<{ accepted: true; authorizedRaw: bigint } | { accepted: false; reason: string }> {
    if (!DIGITS_RE.test(input.cumulativeAmount)) return { accepted: false, reason: "invalid_amount" };
    if (!SIGNATURE_RE.test(input.signature)) return { accepted: false, reason: "invalid_signature" };
    const escrow = this.escrow.read(input.channelId);
    if (!escrow) return { accepted: false, reason: "channel_not_found" };
    if (escrow.settled) return { accepted: false, reason: "channel_closed" };
    const amount = BigInt(input.cumulativeAmount);
    if (amount > escrow.deposit) return { accepted: false, reason: "exceeds_deposit" };

    let signer: Address;
    try {
      signer = await recoverVoucherSigner({
        chainId: this.escrow.chainId,
        escrow: this.escrow.address,
        escrowId: input.channelId as Hex,
        cumulativeAmount: amount,
        signature: input.signature as Hex,
      });
    } catch {
      return { accepted: false, reason: "bad_signature" };
    }
    if (signer !== escrow.signer && signer !== escrow.traveler) return { accepted: false, reason: "bad_signature" };

    const key = input.channelId.toLowerCase();
    const current = this.vouchers.get(key);
    if (!current || amount > current.atomic) {
      this.vouchers.set(key, { atomic: amount, signature: input.signature as Hex, signedAt: this.now().toISOString() });
    }
    return { accepted: true, authorizedRaw: atomicToRaw(this.vouchers.get(key)!.atomic) };
  }

  async getAuthorizedRaw(channelId: string): Promise<bigint> {
    return atomicToRaw(this.vouchers.get(channelId.toLowerCase())?.atomic ?? 0n);
  }

  /** Sends `claim` to the simulated contract; rejects with its revert. */
  async claim(params: {
    channelId: string;
    voucherAmountAtomic: bigint;
    signature: string;
    claimTotalAtomic: bigint;
  }): Promise<{ txHash: string; claimedAtomic: bigint }> {
    await this.escrow.claim(params.channelId, params.voucherAmountAtomic, params.signature, params.claimTotalAtomic);
    return {
      txHash: `0xmock_claim_${++this.seq}`,
      claimedAtomic: params.claimTotalAtomic,
    };
  }

  async readEscrowState(channelId: string): Promise<{
    depositAtomic: bigint;
    claimedAtomic: bigint;
    settled: boolean;
    activeAt?: number;
  } | null> {
    const escrow = this.escrow.read(channelId);
    if (!escrow) return null;
    return {
      depositAtomic: escrow.deposit,
      claimedAtomic: escrow.claimed,
      settled: escrow.settled,
      activeAt: escrow.lastActivityAt,
    };
  }

  getClaimedAtomic(channelId: string): bigint {
    return this.channel(channelId).claimed;
  }

  /**
   * Same as MonadRail: settles at most `settleRaw`, never more than the
   * highest voucher held, and sends that to the contract, which still rejects
   * a settlement below what was already claimed.
   */
  async closeChannel(channelId: string, settleRaw?: bigint): Promise<CloseOutcome> {
    const escrow = this.escrow.read(channelId);
    if (escrow === undefined) return { kind: "failed", reason: "channel_not_found", detail: channelId };
    if (escrow.settled) return { kind: "failed", reason: "close_error", detail: "the channel is already settled" };

    const held = this.vouchers.get(channelId.toLowerCase());
    const voucherAtomic = held?.atomic ?? 0n;
    const wanted = settleRaw === undefined ? voucherAtomic : rawToAtomicFloor(settleRaw);
    const settleAtomic = wanted > voucherAtomic ? voucherAtomic : wanted;
    try {
      const { paid, refunded } =
        settleAtomic === 0n
          ? await this.escrow.close(channelId, 0n, "0x", 0n)
          : await this.escrow.close(channelId, voucherAtomic, held!.signature, settleAtomic);
      return {
        kind: "closed",
        txHash: `demo_close_${hex(`${channelId}:${paid}`, 16)}`,
        settledRaw: atomicToRaw(paid),
        refundedRaw: atomicToRaw(refunded),
      };
    } catch (error) {
      return { kind: "failed", reason: "close_error", detail: messageOf(error) };
    }
  }

  explorerTxUrl(): string | undefined {
    return undefined;
  }
}
