const FLOW = [
  {
    tag: 'once',
    title: 'You deposit into a payment channel',
    body: 'Your USDC goes into a channel contract on Monad, not to us. Only a signed voucher can move it.',
  },
  {
    tag: 'every reading',
    title: 'Each reading gets a signed voucher',
    body: 'As the carrier meters your data, a voucher for the running total is signed off-chain. No gas per MB.',
  },
  {
    tag: 'once',
    title: 'One transaction settles the trip',
    body: 'When you finish, the latest voucher pays AstroAm what you used and the contract returns the rest to you.',
  },
]

export default function UnderTheHood() {
  return (
    <section id="under-the-hood" className="scroll-mt-20 px-4 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <span className="eyebrow">Under the hood</span>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
          One deposit. Thousands of vouchers. One transaction.
        </h2>
        <p className="mt-4 max-w-2xl leading-relaxed text-ink-muted">
          Paying per megabyte on-chain would cost more in fees than the data itself. A payment channel keeps every
          reading off-chain and still lets you walk away with your money: the contract enforces the refund.
        </p>

        <ol className="relative mt-12 grid gap-4 lg:grid-cols-3">
          {FLOW.map((step, i) => (
            <li key={step.title} className="panel relative p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-orbit/50 bg-orbit-dim font-mono text-xs text-orbit">
                  {i + 1}
                </span>
                <span className="chip py-1">{step.tag}</span>
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="panel mt-4 grid gap-6 p-6 sm:grid-cols-3">
          <div>
            <div className="field-label">Deposit</div>
            <div className="tabular mt-1 font-display text-2xl font-semibold">5.00 USDC</div>
          </div>
          <div>
            <div className="field-label">Latest voucher</div>
            <div className="tabular mt-1 font-display text-2xl font-semibold text-orbit">4.50 USDC</div>
          </div>
          <div>
            <div className="field-label">Back to you on close</div>
            <div className="tabular mt-1 font-display text-2xl font-semibold text-signal">0.50 USDC</div>
          </div>
        </div>
      </div>
    </section>
  )
}
