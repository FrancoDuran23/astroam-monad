import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileAppShell from '../components/MobileAppShell'
import WizardProgress from '../components/mission/WizardProgress'
import StepDestination from '../components/mission/StepDestination'
import StepDuration from '../components/mission/StepDuration'
import StepBudget from '../components/mission/StepBudget'
import StepConfirm from '../components/mission/StepConfirm'
import ActivationOverlay from '../components/mission/ActivationOverlay'
import WalletDeposit from '../components/mission/WalletDeposit'
import { useMission } from '../hooks/useMission'
import { addDays, shortTx, today } from '../utils/missionUtils'
import type { PaymentIntentInfo, WizardData, WizardStep } from '../types/mission'

const STEP_LABELS = ['Destination', 'Dates', 'Budget', 'Review']
const TITLES: Record<WizardStep, string> = {
  1: 'Where are you going?',
  2: 'When is the trip?',
  3: 'How much do you want to deposit?',
  4: 'Review your trip',
}

const DEFAULT_DATA: WizardData = {
  destination: null,
  startDate: today(),
  endDate: addDays(today(), 2),
  budgetUsdc: 5,
  dailyLimitUsdc: 5,
  alertAt20pct: true,
  autoPauseAtLimit: true,
}

function DepositPanel({
  intent,
  missionId,
  simulated,
  txHash,
  onTxHash,
  onSubmit,
  onWalletDeposit,
  busy,
}: {
  intent: PaymentIntentInfo
  missionId: string
  simulated: boolean
  txHash: string
  onTxHash: (v: string) => void
  onSubmit: () => void
  onWalletDeposit: (txHash: string) => Promise<void>
  busy: boolean
}) {
  if (intent.evm && !simulated) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <span className="eyebrow">Deposit · {intent.evm.chainName}</span>
          <h2 className="mt-1 font-display text-2xl font-bold">
            {intent.amount} {intent.asset}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Locked in the AstroAm escrow on Monad. AstroAm can only take what you use, signed by this app; the rest comes back when you finish.
          </p>
        </div>
        <WalletDeposit missionId={missionId} plan={intent.evm} onDeposited={onWalletDeposit} label={`Pay ${intent.amount} USDC with wallet`} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="eyebrow">Deposit</span>
          <h2 className="mt-1 font-display text-2xl font-bold">
            {intent.amount} {intent.asset}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Goes into your trip&apos;s payment channel. Unused USDC comes back when you finish.</p>
        </div>
        {simulated && <span className="chip shrink-0 border-warn/40 text-warn">Simulated</span>}
      </div>

      {intent.qr && (
        <div className="mx-auto rounded-2xl bg-ink p-3">
          <img src={intent.qr} alt="Deposit QR code" className="h-44 w-44" />
        </div>
      )}

      {intent.payTo && (
        <div className="rounded-xl border border-line bg-space-900 p-3">
          <div className="field-label">Payment channel address</div>
          <div className="mt-1 break-all font-mono text-xs text-ink-muted">{intent.payTo}</div>
        </div>
      )}

      {intent.paymentUri && !simulated && (
        <a href={intent.paymentUri} className="btn-ghost">
          <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
          Open in wallet
        </a>
      )}

      {!simulated && (
        <label className="flex flex-col gap-2">
          <span className="field-label">Transaction hash</span>
          <input
            id="tx-hash"
            type="text"
            value={txHash}
            onChange={(e) => onTxHash(e.target.value)}
            placeholder="0x…"
            className="min-h-[48px] rounded-xl border border-line bg-space-900 px-3 font-mono text-sm text-ink placeholder:text-ink-faint"
          />
        </label>
      )}

      <button type="button" onClick={onSubmit} disabled={busy || (!simulated && !txHash.trim())} className="btn-primary">
        {busy ? 'Confirming…' : simulated ? 'Simulate deposit' : 'Confirm deposit'}
      </button>
    </div>
  )
}

export default function MissionSetupPage() {
  const navigate = useNavigate()
  const { mission, createMission, createPaymentIntent, confirmPayment, activate, backendError, retryBackend, isDemoMode, caps } = useMission()

  const [step, setStep] = useState<WizardStep>(1)
  const [data, setData] = useState<WizardData>(DEFAULT_DATA)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)

  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentInfo | null>(null)
  const [txHashInput, setTxHashInput] = useState('')
  const [paymentValidating, setPaymentValidating] = useState(false)
  const simulated = isDemoMode || !caps?.paymentsLive

  function update(field: string, value: unknown) {
    setData((prev) => ({ ...prev, [field]: value }))
  }

  function canAdvance(): boolean {
    if (step === 1) return data.destination !== null
    if (step === 2) return data.startDate <= data.endDate
    if (step === 3) {
      const { budgetUsdc: b, dailyLimitUsdc: d } = data
      return Number.isFinite(b) && Number.isFinite(d) && b > 0 && d > 0 && d <= b
    }
    return true
  }

  function next() {
    if (step < 4) setStep((prev) => (prev + 1) as WizardStep)
  }

  function back() {
    if (paymentIntent) setPaymentIntent(null)
    else if (step > 1) setStep((prev) => (prev - 1) as WizardStep)
    else navigate('/')
  }

  async function handleConfirm() {
    setError(null)
    setPreparing(true)
    try {
      if (isDemoMode) {
        setActivating(true)
        await createMission(data)
      } else {
        if (!caps || !caps.backendAvailable) throw new Error('The AstroAm server is not reachable. Check the connection and try again.')
        const created = await createMission(data)
        setPaymentIntent(await createPaymentIntent(created))
      }
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not create the trip')
    } finally {
      setPreparing(false)
    }
  }

  async function handleConfirmPayment() {
    if (!paymentIntent) return
    setError(null)
    setPaymentValidating(true)
    try {
      const txHash = txHashInput.trim() || `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
      const res = await confirmPayment(paymentIntent.intentId, txHash)
      if (!res.valid) throw new Error('The deposit was not accepted.')
      setPaymentIntent(null)
      setActivating(true)
      await activate()
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not confirm the deposit')
    } finally {
      setPaymentValidating(false)
    }
  }

  // Monad: the wallet already sent the deposit; errors surface in the panel.
  async function handleWalletDeposit(txHash: string) {
    if (!paymentIntent) return
    const res = await confirmPayment(paymentIntent.intentId, txHash)
    if (!res.valid) throw new Error('The deposit was not accepted.')
    setPaymentIntent(null)
    setActivating(true)
    try {
      await activate()
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not activate the eSIM')
    }
  }

  return (
    <MobileAppShell title="New trip" showBack showBottomNav={false}>
      {activating && <ActivationOverlay simulated={simulated} onComplete={() => navigate('/mission/esim')} />}

      {!isDemoMode && backendError && (
        <div role="alert" className="panel mb-6 border-alert/40 p-5">
          <div className="flex items-center gap-2 text-alert">
            <span className="material-symbols-outlined">cloud_off</span>
            <h2 className="font-display font-semibold">Can&apos;t reach the server</h2>
          </div>
          <p className="mt-2 text-sm text-ink-muted">{backendError}</p>
          <button type="button" onClick={() => void retryBackend()} className="btn-ghost mt-4 min-h-[40px]">
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Try again
          </button>
        </div>
      )}

      <WizardProgress current={step} labels={STEP_LABELS} />
      <h1 className="mt-5 font-display text-2xl font-bold">{paymentIntent ? 'Add your USDC' : TITLES[step]}</h1>

      <div className="mt-6">
        {paymentIntent ? (
          <DepositPanel
            intent={paymentIntent}
            missionId={mission?.id ?? ''}
            simulated={simulated}
            txHash={txHashInput}
            onTxHash={setTxHashInput}
            onSubmit={() => void handleConfirmPayment()}
            onWalletDeposit={handleWalletDeposit}
            busy={paymentValidating}
          />
        ) : (
          <>
            {step === 1 && <StepDestination selected={data.destination} onSelect={(d) => update('destination', d)} />}
            {step === 2 && (
              <StepDuration
                startDate={data.startDate}
                endDate={data.endDate}
                onChange={(s, e) => setData((prev) => ({ ...prev, startDate: s, endDate: e }))}
              />
            )}
            {step === 3 && data.destination && (
              <StepBudget
                destination={data.destination}
                budgetUsdc={data.budgetUsdc}
                dailyLimitUsdc={data.dailyLimitUsdc}
                alertAt20pct={data.alertAt20pct}
                autoPauseAtLimit={data.autoPauseAtLimit}
                onChange={update}
              />
            )}
            {step === 4 && <StepConfirm data={data} onBack={back} onConfirm={() => void handleConfirm()} busy={preparing} />}
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
          {error}
        </p>
      )}

      {!paymentIntent && step < 4 && (
        <div className="pb-safe sticky bottom-0 -mx-4 mt-8 grid grid-cols-[auto_1fr] gap-3 border-t border-line bg-space-950/90 px-4 pt-4 backdrop-blur">
          <button type="button" onClick={back} className="btn-ghost">
            Back
          </button>
          <button type="button" onClick={next} disabled={!canAdvance()} className="btn-primary">
            Continue
          </button>
        </div>
      )}

      {paymentIntent && (
        <p className="mt-4 text-center font-mono text-[11px] text-ink-faint">Intent {shortTx(paymentIntent.intentId)}</p>
      )}
    </MobileAppShell>
  )
}
