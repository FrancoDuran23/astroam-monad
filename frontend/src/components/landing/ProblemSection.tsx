const PROBLEMS = [
  {
    icon: 'event_busy',
    title: 'Packs expire',
    body: 'A 1 GB travel pack for Brazil costs $3.47–$5.00 and expires in 7 days, whether your trip lasts a week or a weekend.',
  },
  {
    icon: 'data_loss_prevention',
    title: 'Unused data is gone',
    body: 'Use 300 MB of a 1 GB pack and the other 700 MB disappear with it. You paid for data you never touched.',
  },
  {
    icon: 'credit_card_off',
    title: 'Cards fail abroad',
    body: 'Foreign purchase fees, declined cards, currency surprises. Paying for data should not depend on your bank.',
  },
]

export default function ProblemSection() {
  return (
    <section className="px-4 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <span className="eyebrow">The problem</span>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Travel data is built to make you overpay.
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <article key={p.title} className="panel p-6">
              <span className="material-symbols-outlined text-[28px] text-alert">{p.icon}</span>
              <h3 className="mt-4 font-display text-xl font-semibold">{p.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-muted">{p.body}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 font-mono text-[11px] text-ink-faint">Pack prices: Airalo and LATAM Travellers, Brazil, September 2026.</p>
      </div>
    </section>
  )
}
