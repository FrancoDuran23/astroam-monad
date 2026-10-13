import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefundProgress, RefundStatus, RefundTarget } from '../../chain/monad'
import type { FinishResult } from '../../types/mission'
import { fmtUsdc, shortTx } from '../../utils/missionUtils'
import {
  atomicToUsdc,
  fmtRefundDate,
  refundAvailability,
  refundFailureMessage,
  RefundFailure,
  type RefundFailureKind,
} from '../../utils/refundWindow'

const STEP_LABEL: Record<RefundProgress, string> = {
  connecting: 'Connecting wallet…',
  'confirming-wallet': 'Confirm in your wallet…',
  confirming: 'Waiting for Monad…',
}

const RECHECK_MS = 30_000

type Props = {
  /** Null when this browser does not hold the escrow details (it never made the deposit). */
  target: RefundTarget | null
  /** USDC the backend says the trip got back, shown if the chain already closed it. */
  refundedUsdc?: number
  withdraw: (hooks: {
    onProgress: (step: RefundProgress) => void
    onConnected: (account: `0x${string}`) => void
  }) => Promise<{ result: FinishResult; backendNotified: boolean }>
  onWithdrawn: (result: FinishResult, backendNotified: boolean) => void
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * The traveler's protection if AstroAm never closes the trip: after the
 * contract's timeout the unspent balance can be withdrawn from the trip screen.
 * Before it, only a quiet line; nothing here is a warning.
 */
export default function TimeoutRefund({ target, refundedUsdc, withdraw, onWithdrawn }: Props) {
  const [status, setStatus] = useState<RefundStatus | null>(null)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const [step, setStep] = useState<RefundProgress | null>(null)
  const [sender, setSender] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ kind: RefundFailureKind; message: string } | null>(null)

  // The page builds `target` on every render; read again only when the escrow itself changes.
  const targetRef = useRef(target)
  targetRef.current = target
  const targetKey = target ? `${target.contract}:${target.escrowId}:${target.rpcUrl}` : ''

  const read = useCallback(async (): Promise<RefundStatus | null> => {
    const current = targetRef.current
    if (!current) return null
    try {
      const { readRefundStatus } = await import('../../chain/monad')
      const fresh = await readRefundStatus(current)
      setStatus(fresh)
      return fresh
    } catch {
      // The line is a convenience; a failed read leaves it out instead of showing an error.
      return null
    }
  }, [targetKey])

  useEffect(() => {
    void read()
  }, [read])

  // Re-evaluate against the chain's clock, so the action appears when the timeout passes.
  useEffect(() => {
    const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), RECHECK_MS)
    return () => clearInterval(id)
  }, [])

  if (!target || !status) return null

  const availability = refundAvailability(status.escrow, nowSeconds + status.clockOffsetSeconds)
  const traveler = status.escrow.traveler
  const busy = step !== null

  async function run() {
    setFailure(null)
    setSender(null)
    try {
      const { result, backendNotified } = await withdraw({ onProgress: setStep, onConnected: setSender })
      onWithdrawn(result, backendNotified)
    } catch (e) {
      const kind = e instanceof RefundFailure ? e.kind : 'other'
      let message = e instanceof Error ? e.message : 'The withdrawal failed. Nothing was sent.'
      if (kind === 'timeout' || kind === 'settled') {
        // The chain disagrees with the screen: read it again and say what it says now.
        const fresh = await read()
        if (fresh?.availability.kind === 'not-yet') {
          message = refundFailureMessage('timeout', { chainName: target!.chainName, availableAt: fresh.availability.availableAt })
        }
      }
      setFailure({ kind, message })
    } finally {
      setStep(null)
    }
  }

  if (availability.kind === 'missing' || availability.kind === 'nothing') return null

  if (availability.kind === 'settled') {
    return (
      <p className="mb-6 flex items-start gap-2 font-mono text-xs leading-relaxed text-textsecondary">
        <span className="material-symbols-outlined text-base shrink-0" aria-hidden="true">task_alt</span>
        <span>
          This trip was closed on the chain. The unspent balance went to {short(traveler)}
          {refundedUsdc ? ` (${fmtUsdc(refundedUsdc, 2)} USDC)` : ''}.
        </span>
      </p>
    )
  }

  if (availability.kind === 'not-yet') {
    return (
      <p className="mb-6 flex items-start gap-2 font-mono text-xs leading-relaxed text-textsecondary">
        <span className="material-symbols-outlined text-base shrink-0" aria-hidden="true">schedule</span>
        <span>
          If AstroAm never closes this trip you can withdraw the unspent balance yourself from{' '}
          {fmtRefundDate(availability.availableAt)}.
        </span>
      </p>
    )
  }

  const amount = atomicToUsdc(availability.amountAtomic, target.tokenDecimals)
  const otherWallet = sender !== null && sender.toLowerCase() !== traveler.toLowerCase()

  return (
    <section
      aria-labelledby="timeout-refund-title"
      className="mb-6 rounded-2xl p-5 sm:p-6 flex flex-col gap-4 bg-cardbg glass border border-cardborder"
    >
      <div className="flex flex-col gap-1">
        <h3 id="timeout-refund-title" className="font-mono text-xs font-bold text-textsecondary uppercase tracking-widest">
          UNSPENT BALANCE
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-bold text-textprimary tracking-tight">{fmtUsdc(amount, 2)}</span>
          <span className="font-mono text-sm font-bold text-[#B9A6FF]">USDC</span>
        </div>
      </div>

      <p className="text-sm text-textsecondary leading-relaxed max-w-prose">
        AstroAm has not closed this trip within the contract’s timeout, so you can take back what was not spent. It goes to{' '}
        <span className="font-mono text-textprimary">{short(traveler)}</span>, the wallet that paid the deposit.
      </p>

      {otherWallet && (
        <p className="text-sm text-textsecondary leading-relaxed max-w-prose">
          The connected wallet ({short(sender!)}) is not that wallet. It only pays the gas: the balance still goes to{' '}
          <span className="font-mono text-textprimary">{traveler}</span>.
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="w-full py-3.5 px-4 rounded-full bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider shadow-[0_0_22px_rgba(123,92,255,0.5)] hover:bg-primaryviolet-hover active:scale-[0.97] disabled:opacity-50 transition-all flex items-center justify-center gap-2 min-h-[48px] touch-manipulation"
      >
        <span className={`material-symbols-outlined text-base ${busy ? 'animate-spin' : ''}`} aria-hidden="true">
          {busy ? 'refresh' : 'account_balance_wallet'}
        </span>
        {step ? STEP_LABEL[step] : 'WITHDRAW UNSPENT BALANCE'}
      </button>

      {failure && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-alerta/30 bg-alerta/10 p-3">
          <p className="font-mono text-xs text-alerta leading-relaxed">{failure.message}</p>
          {failure.kind === 'wrong-network' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run()}
              className="self-start rounded-full border border-alerta/40 px-4 py-2 font-sans font-bold text-xs uppercase tracking-wider text-alerta hover:bg-alerta/15 min-h-[44px] touch-manipulation disabled:opacity-50"
            >
              SWITCH TO {target.chainName.toUpperCase()}
            </button>
          )}
        </div>
      )}

      <a
        href={`${target.explorer}/address/${target.contract}`}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-xs text-textsecondary hover:text-[#B9A6FF]"
      >
        Escrow {shortTx(target.contract)} ↗
      </a>
    </section>
  )
}
