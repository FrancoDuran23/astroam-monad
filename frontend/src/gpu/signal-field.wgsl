// Landing background: deep space, a slow nebula and concentric signal waves
// radiating from `params.source` (uv space). Waves are a 1-D function of the
// distance to the source, so they stay crisp at any resolution.
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";
import { hash2 } from "@vgpu/wgsl-std/hash";

struct Params {
  time: f32,
  intensity: f32,
  texel: vec2f,
  source: vec2f,
}
@group(0) @binding(0) var<uniform> params: Params;

const SPACE = vec3f(0.020, 0.020, 0.047);
const ORBIT = vec3f(0.545, 0.424, 1.0);
const SIGNAL = vec3f(0.235, 0.902, 0.831);

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = params.texel.y / params.texel.x;
  let p = vec2f(uv.x * aspect, uv.y);
  let src = vec2f(params.source.x * aspect, params.source.y);
  let t = params.time;

  // Nebula: two slow fBM layers tinted violet and teal.
  let n1 = fbmSimplex3d(vec3f(p * 1.6, t * 0.025), 4, 2.17, 0.5) * 0.5 + 0.5;
  let n2 = fbmSimplex3d(vec3f(p * 2.4 + vec2f(5.2, 1.3), t * 0.018), 3, 2.17, 0.5) * 0.5 + 0.5;
  var col = SPACE;
  col += ORBIT * pow(n1, 3.0) * 0.32;
  col += SIGNAL * pow(n2, 4.0) * 0.18;

  // Signal waves: thin rings travelling outwards, fading with distance.
  let d = distance(p, src);
  let phase = d * 22.0 - t * 2.4;
  let ring = pow(max(sin(phase), 0.0), 18.0);
  let fade = exp(-d * 2.6) * smoothstep(0.0, 0.04, d);
  col += mix(SIGNAL, ORBIT, smoothstep(0.1, 0.7, d)) * ring * fade * 0.85 * params.intensity;
  // Soft glow at the source.
  col += SIGNAL * exp(-d * 18.0) * 0.35 * params.intensity;

  // Stars: sparse hashed points with a slow twinkle.
  let cell = floor(uv / params.texel / 4.0);
  let h = hash2(cell).x;
  let star = step(0.9988, h) * (0.55 + 0.45 * sin(t * 1.7 + h * 60.0));
  col += vec3f(star) * 0.8;

  // Vignette + dither against banding.
  let vig = smoothstep(1.25, 0.25, distance(uv, vec2f(0.5, 0.45)));
  col *= mix(0.55, 1.0, vig);
  col += (hash2(uv / params.texel + t) - 0.5).x / 255.0;
  return vec4f(col, 1.0);
}
