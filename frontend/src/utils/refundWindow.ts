// Pure rules for withdrawing the unspent balance after the escrow timeout.
// Kept free of viem and React so it can be tested without a wallet or a chain.

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** The fields of `AstroAmEscrow.escrows(id)` the refund depends on, plus `timeoutSeconds()`. */
export type EscrowSnapshot = {
  traveler: string
  settled: boolean
  deposit: bigint
  claimed: bigint
  lastActivityAt: bigint
  timeoutSeconds: bigint
}

export type RefundAvailability =
  /** The contract has no escrow under this id. */
  | { kind: 'missing' }
  /** Closed or refunded already: nothing can be withdrawn. */
  | { kind: 'settled' }
  /** Open, but everything was already paid out. */
  | { kind: 'nothing' }
  /** Open with a balance, before the timeout. `availableAt` is a unix time in seconds. */
  | { kind: 'not-yet'; availableAt: number; amountAtomic: bigint }
  | { kind: 'available'; amountAtomic: bigint }

/**
 * What the traveler can do with the escrow at `nowSeconds` (chain time, unix seconds).
 * The contract reverts only while `block.timestamp < lastActivityAt + timeoutSeconds`,
 * so exactly at that second the refund is already available.
 */
export function refundAvailability(escrow: EscrowSnapshot, nowSeconds: number): RefundAvailability {
  if (escrow.traveler.toLowerCase() === ZERO_ADDRESS) return { kind: 'missing' }
  if (escrow.settled) return { kind: 'settled' }
  const amountAtomic = escrow.deposit - escrow.claimed
  if (amountAtomic <= 0n) return { kind: 'nothing' }
  const availableAt = escrow.lastActivityAt + escrow.timeoutSeconds
  if (BigInt(Math.floor(nowSeconds)) < availableAt) return { kind: 'not-yet', availableAt: Number(availableAt), amountAtomic }
  return { kind: 'available', amountAtomic }
}

/** "12 Nov 2026, 14:05" in the traveler's own time zone. */
export function fmtRefundDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const day = date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day}, ${time}`
}

export function atomicToUsdc(atomic: bigint, decimals = 6): number {
  return Number(atomic) / 10 ** decimals
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type RefundFailureKind = 'rejected' | 'no-gas' | 'wrong-network' | 'timeout' | 'settled' | 'missing' | 'other'

export class RefundFailure extends Error {
  kind: RefundFailureKind
  constructor(kind: RefundFailureKind, message: string) {
    super(message)
    this.name = 'RefundFailure'
    this.kind = kind
  }
}

/** Walks `error.cause` and gathers what viem and wallets say about a failed refund. */
export function classifyRefundError(error: unknown): RefundFailureKind {
  if (error instanceof RefundFailure) return error.kind
  const texts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    const e = current as Record<string, unknown>
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return 'rejected'
    if (e.code === 4902) return 'wrong-network'
    for (const key of ['name', 'shortMessage', 'message', 'reason']) {
      if (typeof e[key] === 'string') texts.push(e[key] as string)
    }
    const data = e.data
    if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).errorName === 'string') {
      texts.push((data as Record<string, string>).errorName)
    }
    current = e.cause
  }
  const text = texts.join(' | ')
  if (/TimeoutNotReached/.test(text)) return 'timeout'
  if (/AlreadySettled/.test(text)) return 'settled'
  if (/EscrowMissing/.test(text)) return 'missing'
  if (/user rejected|user denied|rejected the request/i.test(text)) return 'rejected'
  if (/ChainMismatch|does not match the target chain|wrong network|unrecognized chain|chain.*not (added|configured)/i.test(text)) {
    return 'wrong-network'
  }
  if (/insufficient funds|exceeds the balance of the account|gas required exceeds allowance/i.test(text)) return 'no-gas'
  return 'other'
}

/** Calm, specific copy for each failure. `availableAt` comes from a fresh read of the chain. */
export function refundFailureMessage(
  kind: RefundFailureKind,
  ctx: { chainName: string; availableAt?: number; fallback?: string },
): string {
  switch (kind) {
    case 'rejected':
      return 'You rejected the request in MetaMask. Nothing was sent; you can try again whenever you like.'
    case 'no-gas':
      return `This wallet has no MON for gas on ${ctx.chainName}. Get some at faucet.monad.xyz, then try again.`
    case 'wrong-network':
      return `Your wallet is not on ${ctx.chainName}. Switch network and try again.`
    case 'timeout':
      return ctx.availableAt
        ? `The timeout has not been reached yet. You can withdraw from ${fmtRefundDate(ctx.availableAt)}.`
        : 'The timeout has not been reached yet.'
    case 'settled':
      return 'This trip was already closed on the chain. Nothing is left to withdraw.'
    case 'missing':
      return 'The contract has no escrow for this trip.'
    default:
      return ctx.fallback || 'The withdrawal failed. Nothing was sent.'
  }
}
