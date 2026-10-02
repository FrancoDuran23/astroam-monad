import { clock, effect, frameLoop, init, surface } from 'vgpu'
import type { FrameLoopHandle } from 'vgpu'
import signalShader from './signal-field.wgsl'
import { hasWebGpu, prefersReducedMotion } from './support'

export type SignalField = {
  /** Moves the wave source (uv space, 0..1, top-left origin). */
  setSource(x: number, y: number): void
  stop(): void
}

/**
 * Starts the landing background on `canvas`. Resolves to `null` when WebGPU
 * is unavailable, so the caller keeps its CSS fallback.
 */
export async function startSignalField(canvas: HTMLCanvasElement, source: [number, number]): Promise<SignalField | null> {
  if (!hasWebGpu()) return null
  let gpu: Awaited<ReturnType<typeof init>>
  try {
    gpu = await init()
  } catch {
    return null
  }

  const canvasSurface = surface(gpu, canvas, { dpr: [1, 1.5] })
  const target = { x: source[0], y: source[1] }
  const current = { x: source[0], y: source[1] }
  const field = effect(gpu, signalShader, {
    label: 'signal-field',
    set: { params: { time: 0, intensity: 1, texel: canvasSurface.texelSize, source: [current.x, current.y] } },
  })
  canvasSurface.onResize(() => field.set({ params: { texel: canvasSurface.texelSize } }))

  let loop: FrameLoopHandle | undefined
  if (prefersReducedMotion()) {
    field.set({ params: { time: 7.3 } })
    field.draw(canvasSurface)
  } else {
    const time = clock(gpu)
    loop = frameLoop(gpu, (frame) => {
      // Ease the source toward the pointer so the waves glide.
      current.x += (target.x - current.x) * 0.04
      current.y += (target.y - current.y) * 0.04
      field.set({ params: { time: time.time, source: [current.x, current.y] } })
      frame.pass(canvasSurface, field)
    })
  }

  return {
    setSource(x, y) {
      target.x = x
      target.y = y
    },
    stop() {
      loop?.stop()
      gpu.dispose()
    },
  }
}
