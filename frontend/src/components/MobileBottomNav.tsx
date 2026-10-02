import { useLocation, useNavigate } from 'react-router-dom'

interface MobileBottomNavProps {
  onActivityClick?: () => void
}

const TABS = [
  { id: 'active', label: 'Trip', icon: 'travel' },
  { id: 'esim', label: 'eSIM', icon: 'sim_card' },
  { id: 'activity', label: 'Activity', icon: 'receipt_long' },
] as const

export default function MobileBottomNav({ onActivityClick }: MobileBottomNavProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onTrip = pathname === '/mission/active'
  const onEsim = pathname === '/mission/esim'

  function go(tab: (typeof TABS)[number]['id']) {
    if (tab === 'active') {
      if (!onTrip) navigate('/mission/active')
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (tab === 'esim') {
      if (!onEsim) navigate('/mission/esim')
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (!onTrip) {
      navigate('/mission/active#activity-feed')
    } else if (onActivityClick) {
      onActivityClick()
    } else {
      document.getElementById('activity-feed')?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const current = onTrip ? 'active' : onEsim ? 'esim' : null

  return (
    <nav aria-label="App" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-space-950/90 backdrop-blur-md">
      <div className="mx-auto grid max-w-lg grid-cols-3 gap-1 px-4 pt-2">
        {TABS.map((tab) => {
          const active = current === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => go(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition ${
                active ? 'bg-signal-dim text-signal' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
