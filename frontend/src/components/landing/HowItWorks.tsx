const STEPS = [
  { icon: 'travel_explore', title: 'Pick where you’re going', body: 'Each country has its own per-MB rate, shown up front.' },
  { icon: 'account_balance_wallet', title: 'Add USDC', body: 'Deposit what you want to spend from your wallet. No card, no account.' },
  { icon: 'qr_code_2', title: 'Install the eSIM', body: 'Scan one QR. The eSIM stays on your phone for the next trip.' },
  { icon: 'cell_tower', title: 'Browse, pay per MB', body: 'Usage is charged as you go. When the trip ends, the rest comes back.' },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 px-4 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <span className="eyebrow">How it works</span>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Four steps, then you just use your phone.
        </h2>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3 bg-space-900 p-6">
              <div className="flex items-center justify-between">
                <span className="material-symbols-outlined text-[28px] text-signal">{s.icon}</span>
                <span className="font-mono text-xs text-ink-faint">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              <p className="text-sm leading-relaxed text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
