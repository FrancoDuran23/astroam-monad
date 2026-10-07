import { useState } from 'react'
import type { DepositProgress } from '../../chain/monad'
import type { EvmDepositPlan } from '../../types/mission'

const STEP_LABEL: Record<DepositProgress, string> = {
  connecting: 'Connecting wallet…',
  approving: 'Approve USDC in your wallet…',
  depositing: 'Confirm the deposit in your wallet…',
  confirming: 'Waiting for Monad…',
}

type Props = {
  missionId: string
  plan: EvmDepositPlan
  /** Called with the escrow transaction hash once it is on-chain. */
  onDeposited: (txHash: string) => Promise<void>
  label: string
}

/**
 * Pays a deposit or top-up from the traveler's MetaMask on Monad:
 * approve USDC, then deposit into (or top up) the trip's escrow.
 */
export default function WalletDeposit({ missionId, plan, onDeposited, label }: Props) {
  const [step, setStep] = useState<DepositProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const amount = Number(plan.amountAtomic) / 10 ** plan.tokenDecimals

  async function pay() {
    setError(null)
    // viem loads only when the traveler pays from a wallet.
    const { sendDeposit, walletError } = await import('../../chain/monad')
    try {
      const hash = await sendDeposit(missionId, plan, setStep)
      setStep('confirming')
      await onDeposited(hash)
    } catch (e) {
      setError(walletError(e))
    } finally {
      setStep(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2 rounded-2xl border border-cardborder bg-warmneutral p-4 text-sm text-textsecondary">
        <li className="flex gap-2">
          <span className="font-mono font-bold text-tealbrand">1</span>
          Approve {amount.toFixed(2)} USDC on {plan.chainName}
        </li>
        <li className="flex gap-2">
          <span className="font-mono font-bold text-tealbrand">2</span>
          {plan.method === 'deposit' ? 'Deposit it into your trip escrow' : 'Add it to your trip escrow'}
        </li>
        {plan.method === 'deposit' && (
          <li className="flex gap-2">
            <span className="font-mono font-bold text-tealbrand">3</span>
            This app gets a session key to sign usage vouchers — no popup per MB
          </li>
        )}
      </ol>

      <p className="rounded-xl border border-starlight/40 bg-starlight/10 p-3 text-sm text-starlight">
        You pay with MetaMask: on a phone it opens the app, on a computer it uses the extension or shows a QR. Test USDC comes from faucet.circle.com and MON for gas from faucet.monad.xyz.
      </p>

      {plan.method === 'deposit' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
          <span className="material-symbols-outlined text-base text-amber-300 shrink-0 mt-0.5">warning</span>
          <div className="flex flex-col gap-0.5 leading-relaxed">
            <span className="font-bold text-amber-300">Session key saved in this browser</span>
            <span>
              The session key is saved in this browser. Clearing browser data means data usage can only be billed up to the last signed voucher.
            </span>
          </div>
        </div>
      )}

      <button type="button" onClick={() => void pay()} disabled={step !== null} className="w-full py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-sm uppercase tracking-wider shadow-[0_0_24px_rgba(123,92,255,0.55)] hover:bg-primaryviolet-hover disabled:opacity-50 transition-all flex items-center justify-center gap-2 min-h-[48px]">
        <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
        {step ? STEP_LABEL[step] : label}
      </button>

      <a
        href={`${plan.explorer}/address/${plan.contract}`}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-[11px] text-textsecondary hover:text-[#B9A6FF]"
      >
        Escrow {plan.contract.slice(0, 10)}…{plan.contract.slice(-6)} ↗
      </a>

      {error && (
        <p role="alert" className="rounded-xl border border-alerta/30 bg-alerta/10 p-3 font-mono text-xs text-alerta">
          {error}
        </p>
      )}
    </div>
  )
}
