import { useEffect, useRef } from 'react'
import { startSignalField, type SignalField } from '../../gpu/signalField'

type Props = {
  /** Where the waves start, in uv space (0..1). */
  source?: [number, number]
  /** Let the pointer move the wave source. */
  followPointer?: boolean
  className?: string
}

/**
 * Full-bleed WebGPU background. The CSS gradient behind the canvas is the
 * fallback: it is what browsers without WebGPU (and the first frame) show.
 */
export default function SignalFieldCanvas({ source = [0.7, 0.5], followPointer = true, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let field: SignalField | null = null
    let cancelled = false
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      field?.setSource((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    }
    void startSignalField(canvas, source).then((f) => {
      if (cancelled) return f?.stop()
      field = f
      if (f) canvas.style.opacity = '1'
      if (f && followPointer) window.addEventListener('pointermove', onMove, { passive: true })
    })
    return () => {
      cancelled = true
      window.removeEventListener('pointermove', onMove)
      field?.stop()
    }
    // source is the initial position only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followPointer])

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{
        background:
          'radial-gradient(60% 55% at 70% 50%, rgba(60,230,212,0.14), transparent 70%), radial-gradient(50% 60% at 20% 30%, rgba(139,108,255,0.18), transparent 70%), #05050C',
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full opacity-0 transition-opacity duration-700" />
    </div>
  )
}
