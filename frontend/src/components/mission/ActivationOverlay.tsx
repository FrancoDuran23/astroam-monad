import { useEffect, useState } from 'react'
import PixelAstronaut from '../brand/PixelAstronaut'

const STEPS = ['Deposit confirmed', 'Payment channel open', 'Provisioning your eSIM', 'Ready for takeoff']

type Props = {
  onComplete: () => void
  /** Payments are simulated (no real chain behind them). */
  simulated?: boolean
}

export default function ActivationOverlay({ onComplete, simulated = true }: Props) {
  const [done, setDone] = useState(0)

  useEffect(() => {
    let i = 0
    let timer = window.setTimeout(function tick() {
      i += 1
      setDone(i)
      if (i < STEPS.length) timer = window.setTimeout(tick, 750)
      else timer = window.setTimeout(onComplete, 700)
    }, 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finished = done >= STEPS.length

  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-space-950/95 px-6 backdrop-blur">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <PixelAstronaut scale={6} connected={finished || done >= 2} label="AstroAm astronaut" />
        <div>
          {simulated && <span className="chip mb-3 border-warn/40 text-warn">Simulated payments</span>}
          <h2 className="font-display text-2xl font-bold">{finished ? 'You’re connected' : 'Setting up your trip…'}</h2>
        </div>
        <ol className="flex w-full flex-col gap-2 text-left">
          {STEPS.map((label, i) => {
            const state = i < done ? 'done' : i === done ? 'running' : 'pending'
            return (
              <li
                key={label}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition ${
                  state === 'done' ? 'border-signal/30 bg-signal-dim' : state === 'running' ? 'border-line-strong' : 'border-line opacity-40'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] ${state === 'done' ? 'text-signal' : 'text-ink-faint'}`}>
                  {state === 'done' ? 'check_circle' : state === 'running' ? 'progress_activity' : 'radio_button_unchecked'}
                </span>
                {label}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
