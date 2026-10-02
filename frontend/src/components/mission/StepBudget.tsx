import { estimateMb, fmtMb } from '../../utils/missionUtils'
import type { Destination } from '../../types/mission'

type Props = {
  destination: Destination
  budgetUsdc: number
  dailyLimitUsdc: number
  alertAt20pct: boolean
  autoPauseAtLimit: boolean
  onChange: (field: string, value: number | boolean) => void
}

function Toggle({ id, checked, onChange, title, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-line bg-space-900 p-4 text-left"
    >
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-sm text-ink-faint">{hint}</span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-signal' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-space-950 transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export default function StepBudget({ destination, budgetUsdc, dailyLimitUsdc, alertAt20pct, autoPauseAtLimit, onChange }: Props) {
  const estimatedMb = estimateMb(budgetUsdc, destination.pricePerMbUsdc)
  const maxDaily = Math.min(budgetUsdc, 10)

  return (
    <div className="flex flex-col gap-7">
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="budget" className="field-label">
            Deposit
          </label>
          <span className="tabular font-display text-3xl font-bold">
            {budgetUsdc.toFixed(2)} <span className="text-base text-ink-muted">USDC</span>
          </span>
        </div>
        <input
          id="budget"
          type="range"
          min={1}
          max={50}
          step={0.5}
          value={budgetUsdc}
          onChange={(e) => {
            const next = Math.max(1, Math.min(50, parseFloat(e.target.value) || 1))
            onChange('budgetUsdc', next)
            if (dailyLimitUsdc > next) onChange('dailyLimitUsdc', next)
          }}
          className="mt-3 w-full"
        />
        <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-faint">
          <span>1 USDC</span>
          <span>50 USDC</span>
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-2xl border border-signal/30 bg-signal-dim p-4">
        <span className="material-symbols-outlined text-[28px] text-signal">signal_cellular_alt</span>
        <div>
          <div className="tabular font-display text-2xl font-bold">≈ {fmtMb(estimatedMb)}</div>
          <p className="text-sm text-ink-muted">
            in {destination.name} at ${(destination.pricePerMbUsdc * 1000).toFixed(2)}/GB. You only pay for what you use.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="daily-limit" className="field-label">
            Daily limit
          </label>
          <span className="tabular font-display text-xl font-semibold">{dailyLimitUsdc.toFixed(2)} USDC / day</span>
        </div>
        <input
          id="daily-limit"
          type="range"
          min={0.5}
          max={maxDaily}
          step={0.5}
          value={Math.min(dailyLimitUsdc, maxDaily)}
          onChange={(e) => onChange('dailyLimitUsdc', parseFloat(e.target.value))}
          className="mt-3 w-full"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Toggle
          id="auto-pause"
          checked={autoPauseAtLimit}
          onChange={(v) => onChange('autoPauseAtLimit', v)}
          title="Pause data at the daily limit"
          hint="Resume anytime from the trip screen."
        />
        <Toggle
          id="low-balance"
          checked={alertAt20pct}
          onChange={(v) => onChange('alertAt20pct', v)}
          title="Warn me below 20%"
          hint="So you can top up before you run out."
        />
      </div>
    </div>
  )
}
