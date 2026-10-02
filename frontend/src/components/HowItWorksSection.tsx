const CARD =
  'w-[82%] sm:w-[280px] lg:w-auto shrink-0 snap-center flex flex-col gap-5 p-6 rounded-2xl bg-cardbg glass border border-cardborder hover:shadow-[0_0_30px_rgba(123,92,255,0.2)] transition-all group'
const SCENE =
  'h-40 w-full rounded-xl bg-[#0A0B1F] flex items-center justify-center relative overflow-hidden border border-primaryviolet/20'

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-20 relative py-24 px-6 md:px-12 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col gap-16">

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 font-mono text-xs font-bold text-[#B9A6FF] tracking-widest uppercase">
            [ LAUNCH SEQUENCE // 4 CHECKPOINTS ]
          </div>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-textprimary text-glow">
            HOW IT WORKS
          </h2>
          <p className="text-base sm:text-lg text-textsecondary">
            Four levels from picking a country to browsing, with every megabyte paid in USDC through a payment channel on Monad.
          </p>
        </div>

        {/* 4 station cards - mobile carousel, desktop grid */}
        <div className="relative flex lg:grid lg:grid-cols-4 gap-5 overflow-x-auto snap-x snap-mandatory pb-4 lg:pb-0 -mx-6 px-6 lg:mx-0 lg:px-0 scrollbar-none">

          {/* Station 1 */}
          <div className={`${CARD} hover:border-primaryviolet/60`}>
            <div className={SCENE}>
              <svg className="w-28 h-28" fill="none" viewBox="0 0 120 120">
                <circle cx="60" cy="60" opacity="0.5" r="45" stroke="#7B5CFF" strokeDasharray="3 3" strokeWidth="1.2" />
                <circle cx="60" cy="60" fill="#14133A" r="26" stroke="#7B5CFF" strokeWidth="1.5" />
                <line opacity="0.4" stroke="#7B5CFF" strokeDasharray="2 2" strokeWidth="0.8" x1="60" x2="60" y1="15" y2="105" />
                <line opacity="0.4" stroke="#7B5CFF" strokeDasharray="2 2" strokeWidth="0.8" x1="15" x2="105" y1="60" y2="60" />
                <circle className="animate-ping" style={{ transformOrigin: '76px 46px' }} cx="76" cy="46" fill="#2FD0DD" r="4" />
                <circle cx="76" cy="46" fill="#2FD0DD" r="3" />
              </svg>
              <span className="absolute bottom-2 left-3 font-mono text-[9px] font-semibold text-[#B9A6FF] tracking-widest">[ COORD: -23.55 // -46.63 ]</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#B9A6FF]">LEVEL 01</span>
                <span className="w-2 h-2 rounded-full bg-primaryviolet shadow-[0_0_8px_#7B5CFF]" />
              </div>
              <h3 className="font-display text-lg font-bold text-textprimary">PICK YOUR DESTINATION</h3>
              <p className="text-xs text-textsecondary leading-relaxed">
                Choose the country you&apos;re flying to and see the exact price per megabyte. No hidden fees, no contracts.
              </p>
            </div>
          </div>

          {/* Station 2 */}
          <div className={`${CARD} hover:border-tealbrand/60`}>
            <div className={SCENE}>
              <svg className="w-28 h-28" fill="none" viewBox="0 0 120 120">
                <rect fill="#0E2430" height="66" rx="16" stroke="#2FD0DD" strokeWidth="1.8" width="34" x="43" y="27" />
                <rect fill="#2FD0DD" fillOpacity="0.25" height="36" rx="10" width="26" x="47" y="53" />
                <line stroke="#2FD0DD" strokeLinecap="round" strokeWidth="1.5" x1="49" x2="71" y1="49" y2="49" />
                <circle cx="60" cy="71" fill="#0E2430" r="7" stroke="#2FD0DD" strokeWidth="1.2" />
                <text fill="#2FD0DD" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="bold" textAnchor="middle" x="60" y="75">$</text>
              </svg>
              <span className="absolute bottom-2 left-3 font-mono text-[9px] font-semibold text-tealbrand tracking-widest">[ ESCROW: USDC ]</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-tealbrand">LEVEL 02</span>
                <span className="w-2 h-2 rounded-full bg-tealbrand shadow-[0_0_8px_#2FD0DD]" />
              </div>
              <h3 className="font-display text-lg font-bold text-textprimary">LOAD FUEL</h3>
              <p className="text-xs text-textsecondary leading-relaxed">
                Deposit USDC from your wallet into the trip escrow on Monad. It isn&apos;t ours: only what you use can be taken out.
              </p>
            </div>
          </div>

          {/* Station 3 */}
          <div className={`${CARD} hover:border-online/60`}>
            <div className={SCENE}>
              <svg className="w-28 h-28" fill="none" viewBox="0 0 120 120">
                <rect fill="#14133A" height="22" rx="3" stroke="#7B5CFF" strokeWidth="1.5" width="16" x="52" y="38" />
                <rect fill="#221C55" height="12" stroke="#7B5CFF" strokeWidth="1.2" width="22" x="24" y="43" />
                <rect fill="#221C55" height="12" stroke="#7B5CFF" strokeWidth="1.2" width="22" x="74" y="43" />
                <path d="M 44 74 A 18 18 0 0 0 76 74" stroke="#3DDC97" strokeDasharray="3 3" strokeWidth="1.5" />
                <path d="M 36 84 A 28 28 0 0 0 84 84" opacity="0.7" stroke="#3DDC97" strokeDasharray="3 3" strokeWidth="1.5" />
                <circle cx="60" cy="96" fill="#3DDC97" r="3.5" />
              </svg>
              <span className="absolute bottom-2 left-3 font-mono text-[9px] font-semibold text-online tracking-widest">[ CITRUS eSIM LINK ]</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-online">LEVEL 03</span>
                <span className="w-2 h-2 rounded-full bg-online shadow-[0_0_8px_#3DDC97]" />
              </div>
              <h3 className="font-display text-lg font-bold text-textprimary">ACTIVATE YOUR eSIM</h3>
              <p className="text-xs text-textsecondary leading-relaxed">
                Scan the QR code in seconds. Your satellite link is ready to switch on before you land.
              </p>
            </div>
          </div>

          {/* Station 4 */}
          <div className={`${CARD} hover:border-starlight/60`}>
            <div className={SCENE}>
              <svg className="w-28 h-28" fill="none" viewBox="0 0 120 120">
                <ellipse cx="60" cy="60" rx="42" ry="18" stroke="#7B5CFF" strokeWidth="1.2" transform="rotate(-15 60 60)" />
                <ellipse cx="60" cy="60" rx="42" ry="18" stroke="#2FD0DD" strokeDasharray="3 3" strokeWidth="1.2" transform="rotate(35 60 60)" />
                <circle cx="60" cy="60" fill="#14133A" r="10" stroke="#7B5CFF" strokeWidth="1.5" />
                <circle cx="60" cy="60" fill="#7B5CFF" r="4" />
                <circle className="animate-pulse" cx="90" cy="52" fill="#FDDA24" r="3.5" />
                <circle cx="32" cy="72" fill="#FDDA24" r="3" />
                <circle cx="50" cy="40" fill="#2FD0DD" r="3" />
              </svg>
              <span className="absolute bottom-2 left-3 font-mono text-[9px] font-semibold text-starlight tracking-widest">[ LIVE MICROPAYMENTS ]</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-starlight">LEVEL 04</span>
                <span className="w-2 h-2 rounded-full bg-starlight shadow-[0_0_8px_#FDDA24]" />
              </div>
              <h3 className="font-display text-lg font-bold text-textprimary">PAY AS YOU GO</h3>
              <p className="text-xs text-textsecondary leading-relaxed">
                Browse without friction. Each block of megabytes is covered by a signed voucher; what you don&apos;t use, you don&apos;t pay.
              </p>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
