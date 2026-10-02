import { useMission } from '../hooks/useMission'

/** Where payments run right now: a live chain, simulated, or no server. */
export default function SystemBadge() {
  const { caps, backendError, isDemoMode } = useMission()

  let tone = 'border-warn/40 text-warn'
  let label = 'Simulated payments'
  if (isDemoMode) {
    label = 'Offline demo'
  } else if (backendError || !caps?.backendAvailable) {
    tone = 'border-alert/40 text-alert'
    label = 'Server offline'
  } else if (caps.paymentsLive) {
    tone = 'border-signal/40 text-signal'
    label = caps.paymentRail
  }

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
