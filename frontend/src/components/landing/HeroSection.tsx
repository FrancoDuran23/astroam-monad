import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SignalFieldCanvas from '../gpu/SignalFieldCanvas'
import PixelAstronaut from '../brand/PixelAstronaut'
import { prefersReducedMotion } from '../../gpu/support'

const RATE = 0.0025 // USDC per MB, Brazil
const DEPOSIT = 5

/** A small live meter: MB tick up, USDC follows, the rest stays yours. */
function LiveMeter() {
  const [mb, setMb] = useState(312)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const id = window.setInterval(() => setMb((v) => (v >= 1900 ? 312 : v + 17)), 900)
    return () => window.clearInterval(id)
  }, [])
  const spent = mb * RATE
  return (
    <div className="panel w-[260px] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between">
        <span className="field-label">Trip to Brazil</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-signal">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" /> live
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="field-label">Used</div>
          <div className="tabular font-display text-2xl font-semibold">{mb.toLocaleString('en-US')} MB</div>
        </div>
        <div>
          <div className="field-label">Paid</div>
          <div className="tabular font-display text-2xl font-semibold text-signal">${spent.toFixed(2)}</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-signal transition-all duration-700" style={{ width: `${(spent / DEPOSIT) * 100}%` }} />
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink-faint">
        ${(DEPOSIT - spent).toFixed(2)} of ${DEPOSIT.toFixed(2)} still yours
      </p>
    </div>
  )
}

export default function HeroSection() {
  return (
    <section className="relative isolate flex min-h-[92vh] items-center overflow-hidden px-4 pb-16 pt-28 sm:px-8">
      <SignalFieldCanvas source={[0.72, 0.52]} className="-z-10" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-space-950" />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="animate-rise">
          <span className="eyebrow">eSIM data, priced per MB</span>
          <h1 className="mt-4 font-display text-[2.6rem] font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Land anywhere.
            <br />
            <span className="text-signal">Pay only for the data you use.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
            Install one eSIM, add USDC, and every megabyte is charged as you browse. No packs that expire, no card
            abroad. Whatever you don&apos;t use goes back to your wallet.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/mission/new" className="btn-primary">
              Plan a trip
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </Link>
            <a href="#how-it-works" className="btn-ghost">
              How it works
            </a>
          </div>
          <ul className="mt-10 flex flex-wrap gap-2">
            <li className="chip">218 countries</li>
            <li className="chip">from $0.82 / GB</li>
            <li className="chip">unused USDC refunded</li>
          </ul>
        </div>

        <div className="relative mx-auto flex h-[420px] w-full max-w-sm items-end justify-center lg:h-[480px]">
          <div className="absolute left-1/2 top-6 -translate-x-1/2 animate-floaty">
            <PixelAstronaut scale={9} connected label="AstroAm astronaut holding up a phone with full signal" />
          </div>
          <div className="relative z-10 translate-x-8 lg:translate-x-16">
            <LiveMeter />
          </div>
        </div>
      </div>
    </section>
  )
}
