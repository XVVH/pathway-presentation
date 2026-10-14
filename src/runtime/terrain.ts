// The ground the trails cross: contour lines from value noise, flattened into
// plateaus under each stop, so the land is shaped around the talk. Returned as
// plain line segments; the renderer turns them into paths once.

import { clamp, lerp, valueNoise } from "./math.ts";
import type { WorldMap } from "./map.ts";

export interface Terrain {
  /** Line segments as x0, y0, x1, y1 quadruples, in world units. */
  minor: Float32Array;
  /** Every fourth level, drawn heavier. */
  major: Float32Array;
}

const LEVELS = 18;
const levelAt = (i: number) => 0.08 + i * (0.84 / LEVELS);
const PLATEAU = levelAt(9.5);
// Marching squares: which cell edges each corner pattern's line crosses
// (0 top, 1 right, 2 bottom, 3 left).
const SEGS: Record<number, [number, number][]> = {
  1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 3], [2, 1]], 6: [[0, 2]], 7: [[0, 3]],
  8: [[0, 3]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
};

export function buildTerrain(map: WorldMap, seed: number): Terrain {
  const b = map.bbox, mx = (b.x1 - b.x0) * 0.5, my = (b.y1 - b.y0) * 0.7;
  const x0 = b.x0 - mx, y0 = b.y0 - my, x1 = b.x1 + mx, y1 = b.y1 + my;
  const cell = Math.max(40, (x1 - x0) / 520);
  const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1;
  const noise = valueNoise(seed), f = 1 / 2900;
  const stations = map.nodes.map(n => ({ x: n.x, y: n.y, r2: (n.ww * 0.62) ** 2 }));
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, y = y0 + j * cell;
      let h = 0, amp = 0.55, fr = f;
      for (let o = 0; o < 3; o++) { h += amp * noise(x * fr + 31.7 * o, y * fr - 17.3 * o); amp *= 0.45; fr *= 2.03; }
      let wsum = 0, flat = 0;
      for (const s of stations) {
        const w = Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * s.r2));
        wsum += w; flat += w * PLATEAU;
      }
      if (wsum > 0) h = lerp(h, flat / wsum, clamp(wsum) * 0.85);
      v[j * nx + i] = h;
    }
  }
  const minor: number[] = [], major: number[] = [];
  for (let li = 1; li < LEVELS; li++) {
    const L = levelAt(li), out = li % 4 === 0 ? major : minor;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = v[j * nx + i], bb = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
        const segs = SEGS[(a > L ? 8 : 0) | (bb > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0)];
        if (!segs) continue;
        const x = x0 + i * cell, y = y0 + j * cell;
        const pt = (e: number): [number, number] =>
          e === 0 ? [x + (cell * (L - a)) / (bb - a), y]
            : e === 1 ? [x + cell, y + (cell * (L - bb)) / (c - bb)]
              : e === 2 ? [x + (cell * (L - d)) / (c - d), y + cell]
                : [x, y + (cell * (L - a)) / (d - a)];
        for (const [e0, e1] of segs) { const p = pt(e0), q = pt(e1); out.push(p[0], p[1], q[0], q[1]); }
      }
    }
  }
  return { minor: Float32Array.from(minor), major: Float32Array.from(major) };
}
