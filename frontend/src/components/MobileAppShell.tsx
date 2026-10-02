import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Logo from './brand/Logo'
import MobileBottomNav from './MobileBottomNav'
import SystemBadge from './SystemBadge'

interface MobileAppShellProps {
  title?: string
  showBack?: boolean
  showBottomNav?: boolean
  onActivityClick?: () => void
  children: React.ReactNode
}

/** Phone-width app frame: dark, centered on desktop, with a faint signal glow. */
export default function MobileAppShell({
  title,
  showBack = false,
  showBottomNav = true,
  onActivityClick,
  children,
}: MobileAppShellProps) {
  const navigate = useNavigate()

  return (
    <div className="relative min-h-screen bg-space-950">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(40% 30% at 50% 0%, rgba(139,108,255,0.14), transparent 70%), radial-gradient(40% 30% at 50% 100%, rgba(60,230,212,0.08), transparent 70%)',
        }}
      />

      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-space-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {showBack && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Go back"
                className="grid h-10 w-10 place-items-center rounded-full text-ink-muted transition hover:bg-white/5 hover:text-ink"
              >
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
            )}
            <Link to="/" aria-label="AstroAm home" className="shrink-0">
              <Logo size="sm" showWordmark={!title} />
            </Link>
            {title && <span className="truncate font-display text-base font-semibold">{title}</span>}
          </div>
          <SystemBadge />
        </div>
      </header>

      <main className={`relative mx-auto max-w-lg px-4 pt-6 ${showBottomNav ? 'pb-safe-nav' : 'pb-safe'}`}>{children}</main>

      {showBottomNav && <MobileBottomNav onActivityClick={onActivityClick} />}
    </div>
  )
}
