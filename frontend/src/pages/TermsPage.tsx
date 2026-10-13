import { useState } from 'react'
import { Link } from 'react-router-dom'
import Footer from '../components/Footer'
import StarfieldBackground from '../components/StarfieldBackground'

/**
 * Draft terms for the testnet demo. Not legal advice. A lawyer has to
 * review this before anyone takes money from a traveler.
 */
export default function TermsPage() {
  const [sent, setSent] = useState(false)

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col">
      <StarfieldBackground />
      <header className="relative z-10 border-b border-cardborder bg-bglight/80 backdrop-blur-sm px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" className="inline-flex items-center min-h-[44px] font-display text-lg font-bold text-textprimary">
            AstroAm
          </Link>
          <Link to="/" className="inline-flex items-center min-h-[44px] px-3 font-mono text-xs text-textsecondary hover:text-white transition-colors">
            BACK
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 px-4 sm:px-6 py-12">
        <article className="max-w-3xl mx-auto flex flex-col gap-8 text-textsecondary">
          <div className="rounded-2xl border border-starlight/50 bg-starlight/10 p-4">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-starlight">Draft — pending legal review</p>
            <p className="mt-2 text-sm text-textprimary">
              This page is a draft for the testnet demo. It is not a contract and it is not legal advice. Do not rely on it until a lawyer reviews it.
            </p>
          </div>

          <header>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-textprimary">Terms</h1>
            <p className="mt-3 text-base leading-relaxed">
              AstroAm is a travel-data demo. On Monad testnet you can lock test USDC in an escrow and get the unused part back. It is not a live phone service.
            </p>
          </header>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-textprimary">Refund rule</h2>
            <p className="leading-relaxed">
              You deposit USDC into the AstroAmEscrow contract. AstroAm cannot move that balance with a normal wallet transfer.
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-2 leading-relaxed">
              <li>While you travel, the app signs usage vouchers in your browser with a session key. The contract pays AstroAm only up to the amount a voucher authorizes, never more than your deposit.</li>
              <li>When the trip ends, you close it. AstroAm receives the usage covered by your vouchers and the rest goes back to your wallet.</li>
              <li>If nobody closes, you can ask for a refund 30 days after the last deposit, top-up or claim. You receive what AstroAm has not collected yet.</li>
              <li>Testnet USDC has no cash value. A mainnet launch would use the same split, after legal review.</li>
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-textprimary">Session key</h2>
            <p className="leading-relaxed">
              The session key lives in this browser. Anyone who can use this browser profile can sign vouchers up to your deposit. Use a device you trust, and clear the browser data only after you close the trip.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-textprimary">Right of withdrawal</h2>
            <p className="leading-relaxed">
              Argentina&apos;s consumer law (Ley 24.240, article 34) gives a person who bought at a distance ten calendar days to revoke the purchase, without penalty. The ten days run from delivery of the good or from the contract, whichever is later. The seller has to show a clear control for this. People call it the botón de arrepentimiento.
            </p>
            <p className="leading-relaxed">
              This demo is not selling a live line. The button below is the draft control. Using it records your request in this browser only. It does not send it to a lawyer or to a carrier, because that contact is not published yet.
            </p>
            <button
              type="button"
              onClick={() => setSent(true)}
              className="self-start min-h-[44px] px-6 py-3 rounded-full bg-[#C8323F] text-white font-sans font-bold text-sm hover:opacity-90 transition-opacity"
            >
              I want to withdraw (botón de arrepentimiento)
            </button>
            {sent && (
              <div role="status" className="rounded-2xl border border-cardborder bg-cardbg p-4 text-sm text-textprimary">
                <p className="font-bold">Withdrawal request noted in this browser.</p>
                <p className="mt-2 text-textsecondary">
                  On testnet, end the mission in the app. The close returns unused test USDC. If 30 days have passed and nobody closed, use the refund in the app. Before a real launch, the team will publish an address for the ten-day statutory request and have this text reviewed.
                </p>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-textprimary">What this demo is not</h2>
            <p className="leading-relaxed">
              The eSIM screen shows a sample test profile unless the carrier returns a real one. Payments are real transactions only when the server points at the deployed AstroAmEscrow contract on Monad testnet and you sign them with your own wallet.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  )
}
