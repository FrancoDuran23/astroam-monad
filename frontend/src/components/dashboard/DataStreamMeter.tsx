import { useEffect, useRef } from 'react'
import { startDataStream, type DataStream } from '../../gpu/dataStream'

type Props = {
  /** Remaining balance as a share of the budget, 0..1. */
  level: number
  /** Changes on every metered reading: each change sends a burst of packets. */
  pulseKey: number
  className?: string
}

/**
 * The balance "tank" (WebGPU). Behind the canvas, a plain CSS fill shows the
 * same level for browsers without WebGPU.
 */
export default function DataStreamMeter({ level, pulseKey, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<DataStream | null>(null)
  const levelRef = useRef(level)
  levelRef.current = level

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    void startDataStream(canvas, levelRef.current).then((s) => {
      if (cancelled) return s?.stop()
      streamRef.current = s
      if (s) canvas.style.opacity = '1'
    })
    return () => {
      cancelled = true
      streamRef.current?.stop()
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    streamRef.current?.setLevel(level)
  }, [level])

  useEffect(() => {
    if (pulseKey > 0) streamRef.current?.pulse()
  }, [pulseKey])

  const fallbackColor = level > 0.45 ? '#3CE6D4' : level > 0.2 ? '#FBBF24' : '#FF6B6B'

  return (
    <div aria-hidden="true" className={`relative overflow-hidden rounded-xl bg-[#090913] ${className}`}>
      <div
        className="absolute inset-x-0 bottom-0 transition-all duration-700"
        style={{ height: `${Math.max(0, Math.min(1, level)) * 100}%`, background: `linear-gradient(to top, ${fallbackColor}22, ${fallbackColor}55)`, borderTop: `2px solid ${fallbackColor}` }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full opacity-0 transition-opacity duration-500" />
    </div>
  )
}
