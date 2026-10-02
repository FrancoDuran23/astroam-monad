import { Link } from 'react-router-dom'
import Logo from '../brand/Logo'

const NAV = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#under-the-hood', label: 'Under the hood' },
]

export default function SiteHeader() {
  return (
    <header className="pt-safe absolute inset-x-0 top-0 z-20 px-4 sm:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 py-4">
        <Link to="/" aria-label="AstroAm home">
          <Logo size="sm" />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="text-sm font-medium text-ink-muted transition hover:text-ink">
              {item.label}
            </a>
          ))}
        </nav>
        <Link to="/mission/new" className="btn-primary min-h-[40px] px-5">
          Plan a trip
        </Link>
      </div>
    </header>
  )
}
