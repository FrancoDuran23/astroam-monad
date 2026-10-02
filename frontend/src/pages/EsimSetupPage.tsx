import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileAppShell from '../components/MobileAppShell'
import { useMission } from '../hooks/useMission'

const STEPS = {
  iphone: [
    'Open Settings → Cellular → Add eSIM.',
    'Choose “Use QR Code” and scan the code above, or enter the LPA code by hand.',
    'Turn the new line on and enable Data Roaming when you land.',
  ],
  android: [
    'Open Settings → Network & internet → SIMs → Add eSIM.',
    'Scan the code above, or choose “Need help?” and paste the LPA code.',
    'Turn the new line on and enable Roaming when you land.',
  ],
}

function CopyRow({ label, value, display }: { label: string; value: string; display?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard refused: the value stays visible and selectable.
    }
  }
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-line bg-space-900 p-2 pl-3">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-ink-muted">{display ?? value}</code>
        <button type="button" onClick={() => void copy()} className="btn-ghost min-h-[36px] shrink-0 px-3 text-xs">
          <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export default function EsimSetupPage() {
  const navigate = useNavigate()
  const { mission } = useMission()
  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
  const [tab, setTab] = useState<'iphone' | 'android'>(
    typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent) ? 'android' : 'iphone',
  )

  if (!mission) {
    return (
      <MobileAppShell title="eSIM">
        <div className="panel flex flex-col items-center gap-4 p-8 text-center">
          <span className="material-symbols-outlined text-[36px] text-ink-faint">sim_card</span>
          <p className="text-ink-muted">Plan a trip to get your eSIM.</p>
          <button type="button" onClick={() => navigate('/mission/new')} className="btn-primary">
            Plan a trip
          </button>
        </div>
      </MobileAppShell>
    )
  }

  const esim = mission.esim
  const simulated = esim?.isMock ?? mission.isMock ?? true

  return (
    <MobileAppShell title="Install your eSIM">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="eyebrow">
            {mission.destination.flag} {mission.destination.name}
          </span>
          <h1 className="mt-1 font-display text-2xl font-bold">Your eSIM is ready</h1>
        </div>
        {simulated && <span className="chip border-warn/40 text-warn">Simulated</span>}
      </div>
      <p className="mt-2 text-sm text-ink-muted">Install it before you fly. It stays on your phone for the next trip.</p>

      <div className="panel mt-6 flex flex-col items-center gap-5 p-6">
        <div className="relative rounded-2xl bg-ink p-3">
          {esim?.qrCode && <img src={esim.qrCode} alt="eSIM activation QR code" className="h-52 w-52" />}
          {simulated && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-space-950/80 p-4 text-center backdrop-blur-sm">
              <div>
                <span className="material-symbols-outlined text-[28px] text-warn">qr_code_2</span>
                <p className="mt-1 font-display font-semibold">Simulated QR</p>
                <p className="text-xs text-ink-muted">There is no real eSIM behind this demo.</p>
              </div>
            </div>
          )}
        </div>
        {!simulated && isIos && esim?.directInstallUrl && (
          <a href={esim.directInstallUrl} target="_blank" rel="noreferrer" className="btn-primary w-full">
            <span className="material-symbols-outlined text-[20px]">phone_iphone</span>
            Install on this iPhone
          </a>
        )}
      </div>

      {esim && (
        <div className="mt-4 flex flex-col gap-4">
          <CopyRow label="LPA activation code" value={esim.lpaString} />
          <CopyRow
            label="ICCID"
            value={esim.iccid}
            display={esim.iccid.length > 16 ? `${esim.iccid.slice(0, 8)}…${esim.iccid.slice(-4)}` : esim.iccid}
          />
        </div>
      )}

      <section className="panel mt-6 p-5" aria-labelledby="install-steps">
        <div className="flex items-center justify-between">
          <h2 id="install-steps" className="font-display font-semibold">
            How to install
          </h2>
          <div className="flex rounded-full border border-line p-0.5" role="tablist">
            {(['iphone', 'android'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${tab === t ? 'bg-white/10 text-ink' : 'text-ink-faint'}`}
              >
                {t === 'iphone' ? 'iPhone' : 'Android'}
              </button>
            ))}
          </div>
        </div>
        <ol className="mt-4 flex flex-col gap-3">
          {STEPS[tab].map((s, i) => (
            <li key={s} className="flex gap-3 text-sm leading-relaxed text-ink-muted">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-signal-dim font-mono text-xs text-signal">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>

      <button type="button" onClick={() => navigate('/mission/active')} className="btn-primary mt-6 w-full">
        I installed it — go to my trip
        <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
      </button>
    </MobileAppShell>
  )
}
