import { DESTINATIONS } from '../../utils/missionUtils'
import type { Destination } from '../../types/mission'

type Props = {
  selected: Destination | null
  onSelect: (dest: Destination) => void
}

export default function StepDestination({ selected, onSelect }: Props) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Destination">
      {DESTINATIONS.map((dest) => {
        const active = selected?.id === dest.id
        return (
          <button
            key={dest.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(dest)}
            className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${
              active ? 'border-signal bg-signal-dim' : 'border-line bg-space-900 hover:border-line-strong'
            }`}
          >
            <span className="text-3xl leading-none" aria-hidden="true">
              {dest.flag}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-semibold">{dest.name}</span>
              <span className="block truncate text-sm text-ink-muted">
                {dest.network} · {dest.coverage}
              </span>
            </span>
            <span className="text-right">
              <span className="tabular block font-display text-lg font-semibold">${(dest.pricePerMbUsdc * 1000).toFixed(2)}</span>
              <span className="block font-mono text-[11px] text-ink-faint">per GB</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
