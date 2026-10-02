import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../../gpu/support'

// The AstroAm astronaut, 19×21 pixels: D outline, W suit, G shade, V visor,
// L glint, P violet, Y emblem. The right arm holds a phone up.
const BASE = [
  '....DDDDDDD........',
  '...DWWWWWWWD.......',
  '..DWWWWWWWWWD......',
  '..DWWDDDDDDWD......',
  '..DWDVVVVLLDWD.....',
  '..DWDVVVVVLDWD.....',
  '..DWDVVVVVVDWD.....',
  '..DWWDDDDDDWWD.....',
  '...DWWWWWWWWD......',
  '..DDDGWWWWGDDD.....',
  '.DGGWWPPPPWWGGD....',
  '.DGWWWPYYPWWWGD....',
  '.DGWWWPPPPWWWGD....',
  '.DGDWWWWWWWWDGD....',
  '.DWDWWWWWWWWDWD....',
  '.DDDGWWWWWWGDDD....',
  '...DWWWDDWWWD......',
  '...DWWWDDWWWD......',
  '...DGWWDDWWGD......',
  '..DPPPDD..DPPPD....',
  '..DDDDD...DDDDD....',
]
const SPRITE = BASE.map((row) => [...row])
for (const y of [11, 12, 13, 14]) {
  SPRITE[y][13] = 'D'
  SPRITE[y][14] = '.'
}
SPRITE[15][13] = 'D'
SPRITE[15][14] = '.'
;([
  [14, 10, 'G'], [15, 10, 'D'],
  [14, 9, 'W'], [15, 9, 'G'], [16, 9, 'D'],
  [15, 8, 'W'], [16, 8, 'W'], [17, 8, 'D'],
  [15, 7, 'D'], [16, 7, 'W'], [17, 7, 'W'], [18, 7, 'D'],
] as const).forEach(([x, y, c]) => {
  SPRITE[y][x] = c
})

const PAL: Record<string, string> = {
  D: '#2B2650', W: '#F4F2FF', G: '#B9B3D6', V: '#3CE6D4', L: '#C9FBF5', P: '#8B6CFF', Y: '#FDDA24',
}
const OX = 2
const OY = 8
const COLS = 25
const ROWS = 30

type Props = {
  /** Size of one sprite pixel, in CSS pixels. */
  scale?: number
  /** Signal found: the phone lights up and emits pixel arcs. */
  connected?: boolean
  className?: string
  label?: string
}

export default function PixelAstronaut({ scale = 8, connected = true, className, label = 'AstroAm astronaut' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    const still = prefersReducedMotion()
    const start = performance.now()
    let raf = 0

    const draw = () => {
      const t = (performance.now() - start) / 1000
      ctx.clearRect(0, 0, COLS, ROWS)
      const dot = (x: number, y: number, c: string) => {
        ctx.fillStyle = c
        ctx.fillRect(x, y, 1, 1)
      }
      SPRITE.forEach((row, y) => row.forEach((ch, x) => ch !== '.' && dot(x + OX, y + OY, PAL[ch])))
      // Phone (4×6) above the raised hand.
      const px = 15 + OX
      const py = 1 + OY
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 4; x++) {
          const edge = x === 0 || x === 3 || y === 0 || y === 5
          dot(px + x, py + y, edge ? '#14112A' : connected ? (y === 1 ? '#FDDA24' : '#3CE6D4') : '#3A3656')
        }
      if (connected) {
        const shown = still ? 3 : Math.min(3, Math.floor((t * 4) % 5))
        const cx = px + 1.5
        const cy = py - 1
        for (let r = 1; r <= shown; r++) {
          const rad = r * 2.2
          for (let y = Math.floor(cy - rad - 1); y <= cy; y++)
            for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
              const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - cy)
              const a = (Math.atan2(y + 0.5 - cy, x - cx) * 180) / Math.PI
              if (Math.abs(d - rad) < 0.55 && a > -140 && a < -40) dot(x, y, r % 2 ? '#3CE6D4' : '#8B6CFF')
            }
        }
      }
      if (!still) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [connected])

  return (
    <canvas
      ref={ref}
      width={COLS}
      height={ROWS}
      role="img"
      aria-label={label}
      className={className}
      style={{ width: COLS * scale, height: ROWS * scale, imageRendering: 'pixelated' }}
    />
  )
}
