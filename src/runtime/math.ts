// Small numeric helpers for the engine: easing, noise, and the camera's long-jump path.

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const DEG = Math.PI / 180;

export function hash(str: string): number {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise in [0, 1], deterministic for a seed. */
export function valueNoise(seed: number): (x: number, y: number) => number {
  const rnd = mulberry32(seed), perm = new Uint8Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x: number, y: number) => vals[perm[(x & 255) + perm[y & 255]]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), u), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), u), w);
  };
}

/**
 * Ramp in, cruise, ramp out: a trapezoid velocity profile with half-cosine ramps.
 * `r` is the share of the move spent speeding up, and again slowing down.
 */
export function rampEase(r: number): (t: number) => number {
  const vmax = 1 / (1 - r);
  const up = (t: number) => vmax * (t / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * t) / r));
  return t => {
    t = clamp(t);
    if (t < r) return up(t);
    if (t > 1 - r) return 1 - up(1 - t);
    return vmax * (r / 2 + t - r);
  };
}

/** A camera: the world point at the centre of the screen, and the visible world width. */
export interface Cam { x: number; y: number; w: number }

/**
 * van Wijk & Nuij (2003), "Smooth and efficient zooming and panning": the path
 * between two views that rises and falls like a flight. `S` is its length.
 */
export function zoomPath(a: Cam, b: Cam, rho: number): { S: number; f: (t: number) => Cam } {
  const rho2 = rho * rho, rho4 = rho2 * rho2;
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
  if (d2 < 1e-6) {
    const S = Math.log(b.w / a.w) / rho;
    return { S: Math.abs(S), f: t => ({ x: a.x + t * dx, y: a.y + t * dy, w: a.w * Math.exp(rho * t * S) }) };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (b.w * b.w - a.w * a.w + rho4 * d2) / (2 * a.w * rho2 * d1);
  const b1 = (b.w * b.w - a.w * a.w - rho4 * d2) / (2 * b.w * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho, c0 = Math.cosh(r0);
  return {
    S,
    f: t => {
      const s = t * S, u = (a.w / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return { x: a.x + u * dx, y: a.y + u * dy, w: (a.w * c0) / Math.cosh(rho * s + r0) };
    },
  };
}
