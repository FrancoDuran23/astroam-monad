import { Link } from 'react-router-dom'
import PixelAstronaut from '../brand/PixelAstronaut'
import Logo from '../brand/Logo'

export function FinalCta() {
  return (
    <section className="px-4 py-24 sm:px-8">
      <div className="panel relative mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden px-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(50% 70% at 50% 100%, rgba(60,230,212,0.16), transparent 70%)' }}
        />
        <PixelAstronaut scale={5} connected label="AstroAm astronaut" />
        <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Your next trip starts with signal.
        </h2>
        <p className="max-w-lg text-ink-muted">Set a budget in USDC, install the eSIM before you fly, and stop thinking about data.</p>
        <Link to="/mission/new" className="btn-primary">
          Plan a trip
          <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
        </Link>
      </div>
    </section>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Logo size="sm" />
        <p className="font-mono text-xs text-ink-faint">
          eSIM by Citrus Mobile · payments on Monad · Monad Metropolis 2026
        </p>
      </div>
    </footer>
  )
}
