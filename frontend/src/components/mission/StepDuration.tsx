import { addDays, daysBetween, fmtDate, today } from '../../utils/missionUtils'

type Props = {
  startDate: string
  endDate: string
  onChange: (start: string, end: string) => void
}

const QUICK = [
  { label: 'Weekend', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]

export default function StepDuration({ startDate, endDate, onChange }: Props) {
  const duration = daysBetween(startDate, endDate)
  const todayStr = today()

  function setQuick(days: number) {
    onChange(todayStr, addDays(todayStr, days - 1))
  }
  function handleStart(val: string) {
    onChange(val, endDate < val ? val : endDate)
  }
  function handleEnd(val: string) {
    if (val >= startDate) onChange(startDate, val)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-2">
        {QUICK.map(({ label, days }) => {
          const active = duration === days
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              onClick={() => setQuick(days)}
              className={`min-h-[48px] rounded-xl border text-sm font-semibold transition ${
                active ? 'border-signal bg-signal-dim text-ink' : 'border-line text-ink-muted hover:border-line-strong'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-2">
          <span className="field-label">From</span>
          <input
            id="trip-start"
            type="date"
            value={startDate}
            min={todayStr}
            onChange={(e) => handleStart(e.target.value)}
            className="min-h-[48px] rounded-xl border border-line bg-space-900 px-3 text-ink [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="field-label">To</span>
          <input
            id="trip-end"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => handleEnd(e.target.value)}
            className="min-h-[48px] rounded-xl border border-line bg-space-900 px-3 text-ink [color-scheme:dark]"
          />
        </label>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-line bg-space-900 px-4 py-3">
        <span className="text-sm text-ink-muted">
          {fmtDate(startDate)} → {fmtDate(endDate)}
        </span>
        <span className="tabular font-display font-semibold">
          {duration} day{duration > 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-sm text-ink-faint">Dates only set the daily limit. You can end the trip anytime and get the rest back.</p>
    </div>
  )
}
