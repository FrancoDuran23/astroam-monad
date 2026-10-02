import { fmtMb, fmtTime, shortTx } from '../../utils/missionUtils'
import type { UsageEvent } from '../../types/mission'

type Props = {
  events: UsageEvent[]
}

export default function ActivityFeed({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-faint">
        No activity yet. Every reading of your data use shows up here with its signed voucher.
      </div>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {events.map((ev) => {
        const topup = ev.kind === 'topup'
        const rejected = ev.status === 'rejected'
        return (
          <li key={ev.id} className="flex items-center gap-3 py-3">
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                topup ? 'bg-orbit-dim text-orbit' : rejected ? 'bg-alert/10 text-alert' : 'bg-signal-dim text-signal'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{topup ? 'add' : rejected ? 'block' : 'bolt'}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {topup ? 'Top-up' : rejected ? `${fmtMb(ev.mb)} — not covered` : `${fmtMb(ev.mb)} used`}
                </span>
                <span className={`tabular shrink-0 font-mono text-sm ${topup ? 'text-orbit' : rejected ? 'text-alert' : ''}`}>
                  {topup ? '+' : '−'}
                  {ev.amountUsdc.toFixed(4)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-ink-faint">
                <span>
                  {fmtTime(ev.timestamp)} · {topup ? 'deposit' : rejected ? 'channel exhausted' : 'voucher signed'}
                </span>
                {ev.txId && (ev.explorerUrl ? (
                  <a href={ev.explorerUrl} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                    {shortTx(ev.txId)}
                  </a>
                ) : (
                  <span>{shortTx(ev.txId)}</span>
                ))}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
