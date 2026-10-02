import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileAppShell from '../components/MobileAppShell'
import ActivityFeed from '../components/dashboard/ActivityFeed'
import TopUpModal from '../components/dashboard/TopUpModal'
import DataStreamMeter from '../components/dashboard/DataStreamMeter'
import { useMission } from '../hooks/useMission'
import { DEMO_TRAFFIC_MB, estimateMb, fmtDate, fmtMb, shortTx } from '../utils/missionUtils'
import type { FinishResult } from '../types/mission'

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-space-900 p-3">
      <div className="field-label">{label}</div>
      <div className={`tabular mt-1 font-display text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function TechRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="field-label">{label}</dt>
      <dd className="break-all text-right font-mono text-xs text-ink-muted">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-signal hover:underline">
            {value} ↗
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

export default function ActiveMissionPage() {
  const navigate = useNavigate()
  const { mission, events, caps, loading, actionLoading, isDemoMode, travelerSigns, authorizedUsdc, retryBackend, simulate, togglePause, finish, reset } =
    useMission()

  const [showTopUp, setShowTopUp] = useState(false)
  const [showFinish, setShowFinish] = useState(false)
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null)
  const [pulseKey, setPulseKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showTech, setShowTech] = useState(false)

  useEffect(() => {
    if (!loading && !mission && !isDemoMode) navigate('/mission/new', { replace: true })
  }, [loading, mission, isDemoMode, navigate])

  if (!mission) return null

  const isPaused = mission.esimStatus === 'paused' || mission.status === 'paused'
  const isCompleted = mission.status === 'completed'
  const level = mission.budgetUsdc > 0 ? mission.balanceUsdc / mission.budgetUsdc : 0
  const pct = Math.round(level * 100)
  const mbLeft = estimateMb(mission.balanceUsdc, mission.destination.pricePerMbUsdc)
  const simulated = isDemoMode || !caps?.paymentsLive

  const state = isCompleted
    ? { label: 'Trip ended', tone: 'text-ink-faint', dot: 'bg-ink-faint' }
    : isPaused
      ? { label: mission.balanceUsdc <= 0 ? 'Out of balance' : 'Data paused', tone: 'text-warn', dot: 'bg-warn' }
      : { label: 'Connected', tone: 'text-signal', dot: 'bg-signal animate-pulse' }

  const note = isCompleted
    ? 'Trip ended. The unused part of your deposit went back to your wallet.'
    : isPaused && mission.balanceUsdc <= 0
      ? 'Your balance is used up, so data is paused. Top up to keep browsing.'
      : isPaused
        ? 'Data is paused. Resume whenever you need it.'
        : pct < 20
          ? `Less than 20% left — about ${fmtMb(mbLeft)}. Top up before you run out.`
          : `About ${fmtMb(mbLeft)} left in ${mission.destination.name} at your current balance.`

  async function handleSimulate() {
    setError(null)
    try {
      await simulate()
      setPulseKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not simulate usage')
    }
  }

  async function handleFinish() {
    setError(null)
    try {
      setFinishResult(await finish())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end the trip')
    }
  }

  return (
    <MobileAppShell
      title="Your trip"
      onActivityClick={() => document.getElementById('activity-feed')?.scrollIntoView({ behavior: 'smooth' })}
      showBottomNav={!showFinish}
    >
      {showTopUp && <TopUpModal onClose={() => { setShowTopUp(false); void retryBackend() }} />}

      {/* Status */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] ${state.tone}`}>
            <span className={`h-2 w-2 rounded-full ${state.dot}`} />
            {state.label}
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold">
            {mission.destination.flag} {mission.destination.name}
          </h1>
          <p className="text-sm text-ink-faint">
            {fmtDate(mission.startDate)} → {fmtDate(mission.endDate)} · {mission.destination.coverage}
          </p>
        </div>
      </div>

      {/* Balance + data stream */}
      <section className="panel mt-5 overflow-hidden p-4" aria-label="Balance">
        <div className="grid grid-cols-[1fr_auto] items-end gap-4">
          <div>
            <div className="field-label">Balance</div>
            <div className="tabular mt-1 font-display text-5xl font-bold leading-none">
              {mission.balanceUsdc.toFixed(2)}
              <span className="ml-1.5 text-lg text-ink-muted">USDC</span>
            </div>
            <div className="mt-2 font-mono text-xs text-ink-faint">
              {pct}% of {mission.budgetUsdc.toFixed(2)} USDC · ≈ {fmtMb(mbLeft)} left
            </div>
          </div>
          <DataStreamMeter level={level} pulseKey={pulseKey} className="h-28 w-24" />
        </div>
      </section>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Used" value={fmtMb(mission.consumedMb)} />
        <Stat label="Spent" value={`$${mission.consumedUsdc.toFixed(2)}`} tone="text-signal" />
        <Stat label="Daily cap" value={`$${mission.dailyLimitUsdc.toFixed(2)}`} />
      </div>

      {travelerSigns && !isCompleted && (
        <p className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-signal/30 bg-signal-dim p-3 text-sm">
          <span className="flex items-center gap-2 text-ink-muted">
            <span className="material-symbols-outlined text-[18px] text-signal">verified_user</span>
            Authorized by this app
          </span>
          <span className="tabular font-mono font-semibold text-signal">{(authorizedUsdc ?? 0).toFixed(2)} USDC</span>
        </p>
      )}

      <p className="mt-3 flex gap-2 rounded-xl border border-line p-3 text-sm text-ink-muted">
        <span className="material-symbols-outlined text-[18px] text-orbit">tips_and_updates</span>
        {note}
      </p>

      {/* Actions */}
      {!isCompleted && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setShowTopUp(true)} disabled={actionLoading} className="btn-primary">
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            Top up
          </button>
          <button type="button" onClick={() => void togglePause()} disabled={actionLoading} className="btn-ghost">
            <span className="material-symbols-outlined text-[20px]">{isPaused ? 'play_arrow' : 'pause'}</span>
            {isPaused ? 'Resume data' : 'Pause data'}
          </button>
          <button type="button" onClick={() => navigate('/mission/esim')} className="btn-ghost">
            <span className="material-symbols-outlined text-[20px]">qr_code_2</span>
            eSIM
          </button>
          <button type="button" onClick={() => void handleSimulate()} disabled={isPaused || actionLoading} className="btn-ghost">
            <span className="material-symbols-outlined text-[20px]">bolt</span>
            Use {DEMO_TRAFFIC_MB} MB
          </button>
        </div>
      )}
      {!isCompleted && (
        <p className="mt-2 text-center font-mono text-[11px] text-ink-faint">
          “Use {DEMO_TRAFFIC_MB} MB” simulates a reading from the carrier.
          {travelerSigns && ' The app signs a voucher for it first, with no wallet popup.'}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
          {error}
        </p>
      )}

      {/* Activity */}
      <section id="activity-feed" className="panel mt-6 scroll-mt-24 p-4" aria-labelledby="activity-title">
        <div className="flex items-center justify-between">
          <h2 id="activity-title" className="font-display font-semibold">
            Activity
          </h2>
          <span className="chip py-1">{events.length} events</span>
        </div>
        <div className="mt-2">
          <ActivityFeed events={events} />
        </div>
      </section>

      {/* Technical details */}
      <section className="panel mt-4 p-4">
        <button type="button" onClick={() => setShowTech(!showTech)} aria-expanded={showTech} className="flex w-full items-center justify-between text-sm font-semibold">
          Payment channel details
          <span className="material-symbols-outlined text-[20px] text-ink-faint">{showTech ? 'expand_less' : 'expand_more'}</span>
        </button>
        {showTech && (
          <dl className="mt-2 divide-y divide-line">
            <TechRow label="Payments" value={caps?.paymentRail ?? (isDemoMode ? 'Offline demo' : '—')} />
            <TechRow label="Network" value={caps?.network ?? mission.network} />
            <TechRow label="Channel" value={mission.channelId || 'pending'} />
            {mission.depositTxHash && <TechRow label="Deposit tx" value={mission.depositTxHash} href={mission.depositExplorerUrl} />}
            {travelerSigns && <TechRow label="Vouchers" value={`signed in this browser · ${(authorizedUsdc ?? 0).toFixed(2)} USDC authorized`} />}
            <TechRow label="eSIM" value={`${mission.esimStatus} · ${mission.iccid ?? mission.esim?.iccid ?? '—'}`} />
            <TechRow label="Carrier" value={mission.esim?.isMock === false ? 'Citrus Mobile' : 'Citrus Mobile (simulated)'} />
          </dl>
        )}
      </section>

      {!isCompleted ? (
        <button type="button" onClick={() => setShowFinish(true)} disabled={actionLoading} className="mt-6 w-full rounded-full py-3 text-sm font-semibold text-alert hover:bg-alert/10">
          End trip and get the rest back
        </button>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => navigate('/mission/new')} className="btn-primary">
            New trip
          </button>
          <button type="button" onClick={() => { reset(); navigate('/', { replace: true }) }} className="btn-ghost">
            {isDemoMode ? 'Reset demo' : 'Done'}
          </button>
        </div>
      )}

      {/* End trip */}
      {showFinish && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="finish-title">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-space-950/80 backdrop-blur-sm" onClick={() => !actionLoading && setShowFinish(false)} />
          <div className="pb-safe relative w-full max-w-lg rounded-t-3xl border border-line bg-space-900 p-6 sm:rounded-3xl">
            {!finishResult ? (
              <>
                <h2 id="finish-title" className="font-display text-xl font-bold">
                  End this trip?
                </h2>
                <p className="mt-2 text-sm text-ink-muted">
                  Your eSIM&apos;s data stops, the latest voucher settles what you used, and the payment channel returns the
                  rest of your deposit — about <strong className="text-ink">{mission.balanceUsdc.toFixed(2)} USDC</strong> — to your wallet.
                  {simulated && ' (Simulated.)'}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setShowFinish(false)} disabled={actionLoading} className="btn-ghost">
                    Keep browsing
                  </button>
                  <button type="button" onClick={() => void handleFinish()} disabled={actionLoading} className="btn-primary">
                    {actionLoading ? 'Settling…' : 'End trip'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[36px] text-signal">task_alt</span>
                <h2 id="finish-title" className="mt-2 font-display text-xl font-bold">
                  Trip settled
                </h2>
                <dl className="mt-4 divide-y divide-line rounded-xl border border-line px-4">
                  <div className="flex justify-between py-3">
                    <dt className="text-sm text-ink-muted">Paid for data</dt>
                    <dd className="tabular font-semibold">{(finishResult.settledUsdc ?? mission.consumedUsdc).toFixed(2)} USDC</dd>
                  </div>
                  <div className="flex justify-between py-3">
                    <dt className="text-sm text-ink-muted">Back to your wallet</dt>
                    <dd className="tabular font-semibold text-signal">{(finishResult.refundedUsdc ?? mission.balanceUsdc).toFixed(2)} USDC</dd>
                  </div>
                  {finishResult.txHash && (
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-ink-muted">Settlement</dt>
                      <dd className="font-mono text-xs">
                        {finishResult.explorerUrl ? (
                          <a href={finishResult.explorerUrl} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                            {shortTx(finishResult.txHash)} ↗
                          </a>
                        ) : (
                          shortTx(finishResult.txHash)
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                <button type="button" onClick={() => setShowFinish(false)} className="btn-primary mt-6 w-full">
                  Close
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </MobileAppShell>
  )
}
