import type { WizardStep } from '../../types/mission'

type Props = {
  current: WizardStep
  labels: string[]
}

export default function WizardProgress({ current, labels }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em]">
        <span className="text-signal">
          Step {current} of {labels.length}
        </span>
        <span className="text-ink-faint">{labels[current - 1]}</span>
      </div>
      <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
        {labels.map((label, i) => (
          <div
            key={label}
            className={`h-1 rounded-full transition-colors duration-500 ${i < current ? 'bg-signal' : 'bg-white/10'}`}
          />
        ))}
      </div>
    </div>
  )
}
