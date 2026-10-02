import { useState } from 'react'
import { useMission } from '../../hooks/useMission'
import WalletDeposit from '../mission/WalletDeposit'
import type { PaymentIntentInfo } from '../../types/mission'

type Props = {
  onClose: () => void
}

export default function TopUpModal({ onClose }: Props) {
  const { mission, isDemoMode, caps, createTopUpIntent, confirmTopUpPayment, actionLoading } = useMission()
  const [amount, setAmount] = useState(5)
  const [intent, setIntent] = useState<PaymentIntentInfo | null>(null)
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const simulated = isDemoMode || !caps?.paymentsLive

  async function start() {
    setError(null)
    try {
      if (isDemoMode) {
        await confirmTopUpPayment(`intent_demo_${Date.now()}`, `0x${Date.now().toString(16)}`, amount)
        onClose()
      } else {
        setIntent(await createTopUpIntent(amount))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the top-up')
    }
  }

  async function confirm() {
    if (!intent) return
    setError(null)
    try {
      await confirmTopUpPayment(intent.intentId, txHash.trim() || `0x${Date.now().toString(16)}`, amount)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm the top-up')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="topup-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-space-950/80 backdrop-blur-sm" onClick={() => !actionLoading && onClose()} />
      <div className="pb-safe relative w-full max-w-lg rounded-t-3xl border border-line bg-space-900 p-6 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 id="topup-title" className="font-display text-xl font-bold">
            Top up your trip
          </h2>
          {simulated && <span className="chip border-warn/40 text-warn">Simulated</span>}
        </div>

        {!intent ? (
          <>
            <div className="mt-6 flex items-baseline justify-between">
              <label htmlFor="topup-amount" className="field-label">
                Amount
              </label>
              <span className="tabular font-display text-3xl font-bold">{amount.toFixed(2)} USDC</span>
            </div>
            <input
              id="topup-amount"
              type="range"
              min={1}
              max={50}
              step={0.5}
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value))}
              className="mt-3 w-full"
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[5, 10, 20].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={amount === v}
                  onClick={() => setAmount(v)}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold ${amount === v ? 'border-signal bg-signal-dim' : 'border-line text-ink-muted'}`}
                >
                  {v} USDC
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-ink-muted">Added to the same payment channel. Unused USDC still comes back when you finish.</p>
            <button type="button" onClick={() => void start()} disabled={actionLoading} className="btn-primary mt-6 w-full">
              {simulated ? `Simulate ${amount.toFixed(2)} USDC deposit` : 'Continue'}
            </button>
          </>
        ) : intent.evm && !simulated && mission ? (
          <div className="mt-6">
            <WalletDeposit
              missionId={mission.id}
              plan={intent.evm}
              label={`Add ${amount.toFixed(2)} USDC with wallet`}
              onDeposited={async (hash) => {
                await confirmTopUpPayment(intent.intentId, hash, amount)
                onClose()
              }}
            />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {intent.qr && (
              <div className="mx-auto rounded-2xl bg-ink p-3">
                <img src={intent.qr} alt="Top-up QR code" className="h-40 w-40" />
              </div>
            )}
            {intent.paymentUri && !simulated && (
              <a href={intent.paymentUri} className="btn-ghost">
                Open in wallet
              </a>
            )}
            {!simulated && (
              <label className="flex flex-col gap-2">
                <span className="field-label">Transaction hash</span>
                <input
                  id="topup-tx"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="0x…"
                  className="min-h-[48px] rounded-xl border border-line bg-space-950 px-3 font-mono text-sm"
                />
              </label>
            )}
            <button type="button" onClick={() => void confirm()} disabled={actionLoading || (!simulated && !txHash.trim())} className="btn-primary w-full">
              {simulated ? 'Simulate deposit' : 'Confirm top-up'}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
