import shipSmSrc from '../assets/ship-night.png'

const steps = [
  { icon: 'account_circle', color: 'text-[#B9A6FF]', step: 'STEP 01', title: 'TRAVELER', desc: 'Sets a budget and browses', img: null },
  { icon: null, color: '', step: 'STEP 02', title: 'ASTROAM APP', desc: 'Signs vouchers in the background', img: shipSmSrc },
  { icon: 'toll', color: 'text-starlight', step: 'STEP 03', title: 'CHECKPOINT', desc: 'Meters usage per reading', img: null },
  { icon: 'hub', color: 'text-tealbrand', step: 'STEP 04', title: 'MONAD', desc: 'One transaction settles the trip', img: null },
  { icon: 'cell_tower', color: 'text-online', step: 'STEP 05', title: 'CARRIER', desc: 'Keeps the 4G/5G link up', img: null },
]

const stepColors: Record<string, string> = {
  'STEP 01': 'text-[#B9A6FF]',
  'STEP 02': 'text-[#B9A6FF]',
  'STEP 03': 'text-starlight',
  'STEP 04': 'text-tealbrand',
  'STEP 05': 'text-online',
}

const pillars = [
  { code: '01 // USDC', color: 'text-[#B9A6FF]', title: 'Stable money', desc: 'No exchange-rate swings or unexpected bank fees while you travel.' },
  { code: '02 // MICROPAYMENTS', color: 'text-tealbrand', title: 'Tiny increments', desc: 'Pay for the megabytes you download and not a cent more.' },
  { code: '03 // ESCROW', color: 'text-starlight', title: 'Your funds, locked', desc: 'AstroAm can only take what your app signed for; the rest returns to you.' },
  { code: '04 // TRANSPARENCY', color: 'text-online', title: 'Verifiable record', desc: 'Deposit and settlement are on-chain, visible in the Monad explorer.' },
]

export default function TechnologySection() {
  return (
    <section id="technology" className="scroll-mt-20 relative py-24 px-6 md:px-12 border-t border-cardborder/60 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col gap-16">

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-3 max-w-3xl mx-auto">
          <span className="font-mono text-xs font-bold text-tealbrand uppercase tracking-widest">
            [ DETERMINISTIC SETTLEMENT ARCHITECTURE ]
          </span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-textprimary text-glow">
            MICROPAYMENTS THAT POWER EVERY LEG
          </h2>
          <p className="text-base sm:text-lg text-textsecondary">
            An auditable circuit where every megabyte is covered by a signed voucher, and one transaction on Monad settles the trip.
          </p>
        </div>

        {/* 5-step circuit */}
        <div className="w-full p-8 md:p-10 rounded-3xl bg-cardbg glass border border-cardborder relative overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 relative z-10 items-center">
            {steps.map((s) => (
              <div
                key={s.step}
                className="flex flex-col items-center text-center p-5 rounded-2xl bg-warmneutral border border-cardborder hover:border-primaryviolet hover:shadow-[0_0_24px_rgba(123,92,255,0.3)] transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-[#14133A] border border-cardborder flex items-center justify-center mb-3">
                  {s.img ? (
                    <img src={s.img} alt={s.title} className="w-full h-full object-contain p-1.5" />
                  ) : (
                    <span className={`material-symbols-outlined text-2xl ${s.color}`}>{s.icon}</span>
                  )}
                </div>
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${stepColors[s.step]}`}>{s.step}</span>
                <span className="font-display text-base font-bold text-textprimary mt-1">{s.title}</span>
                <span className="text-xs text-textsecondary mt-1">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 4 pillar cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {pillars.map((p) => (
            <div key={p.code} className="p-6 rounded-2xl bg-cardbg glass border border-cardborder hover:border-primaryviolet/50 transition-colors flex flex-col gap-2">
              <span className={`font-mono text-xs font-bold tracking-wider ${p.color}`}>{p.code}</span>
              <h4 className="font-display text-lg font-bold text-textprimary">{p.title}</h4>
              <p className="text-xs text-textsecondary leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
