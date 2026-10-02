import { daysBetween, estimateMb, fmtDate, fmtMb } from '../../utils/missionUtils'
import type { WizardData } from '../../types/mission'

type Props = {
  data: WizardData
  onBack: () => void
  onConfirm: () => void
  busy?: boolean
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={`tabular text-right font-semibold ${accent ? 'text-signal' : ''}`}>{value}</dd>
    </div>
  )
}

export default function StepConfirm({ data, onBack, onConfirm, busy = false }: Props) {
  const { destination, startDate, endDate, budgetUsdc, dailyLimitUsdc } = data
  if (!destination) return null
  const duration = daysBetween(startDate, endDate)

  return (
    <div className="flex flex-col gap-6">
      <dl className="divide-y divide-line rounded-2xl border border-line bg-space-900 px-4">
        <Row label="Destination" value={`${destination.flag} ${destination.name}`} />
        <Row label="Dates" value={`${fmtDate(startDate)} → ${fmtDate(endDate)} · ${duration}d`} />
        <Row label="Rate" value={`$${(destination.pricePerMbUsdc * 1000).toFixed(2)} per GB`} />
        <Row label="Deposit" value={`${budgetUsdc.toFixed(2)} USDC`} accent />
        <Row label="Covers about" value={fmtMb(estimateMb(budgetUsdc, destination.pricePerMbUsdc))} />
        <Row label="Daily limit" value={`${dailyLimitUsdc.toFixed(2)} USDC`} />
      </dl>

      <p className="flex gap-3 rounded-xl border border-line p-4 text-sm leading-relaxed text-ink-muted">
        <span className="material-symbols-outlined text-[20px] text-signal">verified_user</span>
        Your deposit goes into a payment channel, not to us. When you end the trip, whatever you didn&apos;t use is
        returned automatically.
      </p>

      <div className="grid grid-cols-[auto_1fr] gap-3">
        <button type="button" onClick={onBack} className="btn-ghost" disabled={busy}>
          Edit
        </button>
        <button type="button" onClick={onConfirm} className="btn-primary" disabled={busy}>
          {busy ? 'Preparing…' : `Continue to deposit`}
        </button>
      </div>
    </div>
  )
}
