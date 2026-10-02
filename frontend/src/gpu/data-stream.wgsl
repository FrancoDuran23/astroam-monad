// Dashboard meter: a balance "tank" that drains as data is used. Packets fall
// in columns; `params.flow` speeds them up while traffic is metered, and the
// liquid shifts teal → amber → red as `params.level` (0..1) drops.
import { simplex2d } from "@vgpu/wgsl-std/noise/simplex";
import { hash2 } from "@vgpu/wgsl-std/hash";

struct Params {
  time: f32,
  level: f32,
  flow: f32,
  _pad: f32,
  texel: vec2f,
}
@group(0) @binding(0) var<uniform> params: Params;

const BG = vec3f(0.035, 0.035, 0.075);
const SIGNAL = vec3f(0.235, 0.902, 0.831);
const AMBER = vec3f(0.984, 0.749, 0.141);
const ALERT = vec3f(1.0, 0.420, 0.420);

fn liquidColor(level: f32) -> vec3f {
  let warm = mix(ALERT, AMBER, smoothstep(0.05, 0.25, level));
  return mix(warm, SIGNAL, smoothstep(0.2, 0.45, level));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = params.time;
  let px = uv / params.texel;
  var col = BG;

  // Falling packets: one stream per 14px column, random speed and phase.
  let colIdx = floor(px.x / 14.0);
  let r = hash2(vec2f(colIdx, 7.0)).x;
  let speed = mix(0.12, 0.45, r) * (0.35 + params.flow * 2.2);
  let y = fract(uv.y * 0.9 - t * speed + r * 13.0);
  let inColumn = 1.0 - smoothstep(1.2, 2.2, abs(px.x - (colIdx + 0.5) * 14.0));
  let packet = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.03, 0.18, y));
  col += SIGNAL * packet * inColumn * (0.18 + 0.5 * params.flow) * step(0.35, r);

  // Liquid: level from the bottom with a gently moving surface.
  let surface = 1.0 - params.level + simplex2d(vec2f(uv.x * 3.0, t * 0.6)) * 0.018 * (0.4 + params.flow);
  let below = smoothstep(surface - 0.004, surface + 0.004, uv.y);
  let liquid = liquidColor(params.level);
  let depth = clamp((uv.y - surface) / max(params.level, 0.05), 0.0, 1.0);
  col = mix(col, liquid * mix(0.55, 0.22, depth), below * 0.9);
  // Bright meniscus line.
  col += liquid * (1.0 - smoothstep(0.0, 0.012, abs(uv.y - surface))) * 0.9;

  col += (hash2(px + t) - 0.5).x / 255.0;
  return vec4f(col, 1.0);
}
