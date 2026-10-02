import { useState } from 'react'
import { DESTINATIONS, fmtMb } from '../../utils/missionUtils'

const PACK = { mb: 1000, usd: 5.0, label: 'Typical 1 GB travel pack' }

export default function PriceCalculator() {
  const [destId, setDestId] = useState(DESTINATIONS[0].id)
  const [mb, setMb] = useState(300)
  const dest = DESTINATIONS.find((d) => d.id === destId) ?? DESTINATIONS[0]
  const ours = mb * dest.pricePerMbUsdc
  const packCount = Math.max(1, Math.ceil(mb / PACK.mb))
  const pack = packCount * PACK.usd
  const wasted = packCount * PACK.mb - mb

  return (
    <section id="pricing" className="scroll-mt-20 px-4 py-24 sm:px-8">
      <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="eyebrow">Pricing</span>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">Pay for 300 MB, not for 1 GB.</h2>
          <p className="mt-4 max-w-md leading-relaxed text-ink-muted">
            Our rate is the carrier&apos;s wholesale price per country plus a fixed margin. You see it before you pay,
            and you never buy data in advance.
          </p>
          <table className="mt-8 w-full max-w-md text-left text-sm">
            <thead>
              <tr className="field-label">
                <th className="pb-2 font-normal">Country</th>
                <th className="pb-2 text-right font-normal">Per MB</th>
                <th className="pb-2 text-right font-normal">Per GB</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {DESTINATIONS.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-2.5">
                    {d.flag} {d.name}
                  </td>
                  <td className="py-2.5 text-right font-mono text-ink-muted">${d.pricePerMbUsdc.toFixed(4)}</td>
                  <td className="py-2.5 text-right font-mono">${(d.pricePerMbUsdc * 1000).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {DESTINATIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDestId(d.id)}
                aria-pressed={d.id === destId}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  d.id === destId ? 'border-signal bg-signal-dim text-ink' : 'border-line text-ink-muted hover:border-line-strong'
                }`}
              >
                {d.flag} {d.name}
              </button>
            ))}
          </div>

          <label htmlFor="calc-mb" className="field-label mt-8 block">
            Data you&apos;ll actually use
          </label>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="tabular font-display text-4xl font-bold">{fmtMb(mb)}</span>
            <span className="font-mono text-xs text-ink-faint">maps, chat, a few photos ≈ 300 MB</span>
          </div>
          <input
            id="calc-mb"
            type="range"
            min={50}
            max={3000}
            step={50}
            value={mb}
            onChange={(e) => setMb(Number(e.target.value))}
            className="mt-4 w-full"
          />

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-signal/40 bg-signal-dim p-4">
              <div className="field-label text-signal">AstroAm</div>
              <div className="tabular mt-1 font-display text-3xl font-bold">${ours.toFixed(2)}</div>
              <p className="mt-1 text-sm text-ink-muted">exactly {fmtMb(mb)}, nothing left over</p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="field-label">{PACK.label}</div>
              <div className="tabular mt-1 font-display text-3xl font-bold text-ink-muted">${pack.toFixed(2)}</div>
              <p className="mt-1 text-sm text-ink-faint">
                {packCount > 1 ? `${packCount} packs, ` : ''}
                {wasted > 0 ? `${fmtMb(wasted)} expire unused` : 'nothing wasted'}
              </p>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-ink-faint">
            Pack price: $5.00 per GB, 7-day validity (Airalo, Brazil, September 2026). Packs vary by country.
          </p>
        </div>
      </div>
    </section>
  )
}
