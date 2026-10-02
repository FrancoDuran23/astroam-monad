import { clock, effect, frameLoop, init, surface } from 'vgpu'
import type { FrameLoopHandle } from 'vgpu'
import streamShader from './data-stream.wgsl'
import { hasWebGpu, prefersReducedMotion } from './support'

export type DataStream = {
  /** Remaining balance as a share of the budget, 0..1. */
  setLevel(level: number): void
  /** A burst of metered traffic: packets speed up, then settle. */
  pulse(): void
  stop(): void
}

export async function startDataStream(canvas: HTMLCanvasElement, level: number): Promise<DataStream | null> {
  if (!hasWebGpu()) return null
  let gpu: Awaited<ReturnType<typeof init>>
  try {
    gpu = await init()
  } catch {
    return null
  }

  const canvasSurface = surface(gpu, canvas, { dpr: [1, 2] })
  const state = { level, shownLevel: level, flow: 0.15 }
  const stream = effect(gpu, streamShader, {
    label: 'data-stream',
    set: { params: { time: 0, level, flow: state.flow, _pad: 0, texel: canvasSurface.texelSize } },
  })
  canvasSurface.onResize(() => stream.set({ params: { texel: canvasSurface.texelSize } }))

  const reduced = prefersReducedMotion()
  let loop: FrameLoopHandle | undefined
  const drawStill = () => {
    stream.set({ params: { time: 3.1, level: state.level, flow: 0.15 } })
    stream.draw(canvasSurface)
  }
  if (reduced) {
    drawStill()
  } else {
    const time = clock(gpu)
    loop = frameLoop(gpu, (frame) => {
      state.shownLevel += (state.level - state.shownLevel) * 0.06
      state.flow += (0.15 - state.flow) * 0.02
      stream.set({ params: { time: time.time, level: state.shownLevel, flow: state.flow } })
      frame.pass(canvasSurface, stream)
    })
  }

  return {
    setLevel(next) {
      state.level = Math.min(1, Math.max(0, next))
      if (reduced) drawStill()
    },
    pulse() {
      state.flow = 1
    },
    stop() {
      loop?.stop()
      gpu.dispose()
    },
  }
}
