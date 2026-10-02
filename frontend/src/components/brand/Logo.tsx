import mark from '../../assets/ship.png'

type Props = { size?: 'sm' | 'md' | 'lg'; showWordmark?: boolean }

const SIZES = { sm: { mark: 'h-8 w-8', img: 'h-6 w-6', text: 'text-lg' }, md: { mark: 'h-10 w-10', img: 'h-8 w-8', text: 'text-xl' }, lg: { mark: 'h-14 w-14', img: 'h-11 w-11', text: 'text-3xl' } }

/** The A-and-ring mark on a white disc (it is drawn for light grounds) + wordmark. */
export default function Logo({ size = 'md', showWordmark = true }: Props) {
  const s = SIZES[size]
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className={`${s.mark} grid place-items-center rounded-full bg-ink shadow-[0_0_24px_rgba(139,108,255,0.45)]`}>
        <img src={mark} alt="" className={s.img} />
      </span>
      {showWordmark && (
        <span className={`font-display font-bold tracking-wide ${s.text}`}>
          <span className="text-ink">AST</span>
          <span className="text-orbit">ROAM</span>
        </span>
      )}
    </span>
  )
}
