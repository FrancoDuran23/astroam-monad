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

function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && typeof window.ethereum?.request === 'function'
}

/**
 * Pays a deposit or top-up from the traveler's browser wallet on Monad:
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
      <ol className="flex flex-col gap-2 rounded-xl border border-line bg-space-900 p-3 text-sm text-ink-muted">
        <li className="flex gap-2">
          <span className="font-mono text-signal">1</span>
          Approve {amount.toFixed(2)} USDC on {plan.chainName}
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-signal">2</span>
          {plan.method === 'deposit' ? 'Deposit it into your trip escrow' : 'Add it to your trip escrow'}
        </li>
        {plan.method === 'deposit' && (
          <li className="flex gap-2">
            <span className="font-mono text-signal">3</span>
            This app gets a session key to sign usage vouchers — no popup per MB
          </li>
        )}
      </ol>

      {!hasInjectedWallet() && (
        <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          No browser wallet found. Install MetaMask or Rabby, add test USDC from faucet.circle.com and MON for gas from faucet.monad.xyz.
        </p>
      )}

      <button type="button" onClick={() => void pay()} disabled={step !== null || !hasInjectedWallet()} className="btn-primary">
        <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
        {step ? STEP_LABEL[step] : label}
      </button>

      <a
        href={`${plan.explorer}/address/${plan.contract}`}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-[11px] text-ink-faint hover:text-signal"
      >
        Escrow {plan.contract.slice(0, 10)}…{plan.contract.slice(-6)} ↗
      </a>

      {error && (
        <p role="alert" className="rounded-xl border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
          {error}
        </p>
      )}
    </div>
  )
}
