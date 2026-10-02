import SiteHeader from '../components/landing/SiteHeader'
import HeroSection from '../components/landing/HeroSection'
import ProblemSection from '../components/landing/ProblemSection'
import HowItWorks from '../components/landing/HowItWorks'
import PriceCalculator from '../components/landing/PriceCalculator'
import UnderTheHood from '../components/landing/UnderTheHood'
import { FinalCta, SiteFooter } from '../components/landing/FinalCta'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-space-950">
      <SiteHeader />
      <main>
        <HeroSection />
        <ProblemSection />
        <HowItWorks />
        <PriceCalculator />
        <UnderTheHood />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}
