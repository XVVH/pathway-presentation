// The canvas under the cards: the land, the trails, the route walked so far,
// and stations too small to show a card. Also the minimap.

import type { Cam } from "./math.ts";
import { lerp, smoothstep } from "./math.ts";
import { trailPath, type Edge, type MapNode, type WorldMap } from "./map.ts";
import type { Terrain } from "./terrain.ts";
import type { Lit } from "./timeline.ts";
import type { Tokens } from "./dom.ts";

function segmentsPath(segs: Float32Array): Path2D {
  const p = new Path2D();
  for (let i = 0; i + 3 < segs.length; i += 4) { p.moveTo(segs[i], segs[i + 1]); p.lineTo(segs[i + 2], segs[i + 3]); }
  return p;
}

/** Unwalked trails are dashed; detours more sparsely. Hover lighting uses the same dashes so they line up. */
const trailDash = (e: Edge, k: number) => (e.detour ? [2 / k, 7 / k] : [7 / k, 6 / k]);

export interface GroundView {
  cam: Cam;
  vw: number;
  vh: number;
  dpr: number;
  lit: Lit;
  tokens: Tokens;
  /** Plain ground and no shadows: screen-share encoders cope better. */
  plain: boolean;
  /** Light the trail from `from` to this stop, as an invitation to go there. */
  hover: { from: MapNode; to: MapNode } | null;
}

export class Ground {
  readonly canvas: HTMLCanvasElement;
  readonly map: WorldMap;
  private ctx: CanvasRenderingContext2D;
  private minor: Path2D;
  private major: Path2D;

  constructor(canvas: HTMLCanvasElement, map: WorldMap, terrain: Terrain) {
    this.canvas = canvas;
    this.map = map;
    this.ctx = canvas.getContext("2d")!;
    this.minor = segmentsPath(terrain.minor);
    this.major = segmentsPath(terrain.major);
  }

  resize(vw: number, vh: number, dpr: number): void {
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);
  }

  draw(v: GroundView): void {
    const { ctx, map } = this, { cam, vw, vh, dpr, tokens: T } = v, k = vw / cam.w;
    const { lit, visited } = v.lit;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = T.ground;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const world = () => ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (vw / 2 - cam.x * k), dpr * (vh / 2 - cam.y * k));
    world();
    const mapW = (map.bbox.x1 - map.bbox.x0) * 1.06;
    if (!v.plain && T.terrain === "contours") {
      const near = smoothstep(mapW * 0.6, mapW * 0.12, cam.w);
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = T.contour; ctx.globalAlpha = 0.16 + 0.6 * near;
      ctx.stroke(this.minor);
      ctx.strokeStyle = T.contourMajor; ctx.lineWidth = 1.5 / k; ctx.globalAlpha = 0.55 + 0.3 * near;
      ctx.stroke(this.major);
      ctx.globalAlpha = 1;
    } else if (!v.plain && T.terrain === "dots") {
      // A dot grid that doubles its spacing as you zoom out, crossfading between scales.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lv = Math.log2(cam.w / 24), base = 2 ** Math.floor(lv);
      for (const [sp, alpha] of [[base, 1 - (lv - Math.floor(lv))], [base * 2, 1]]) {
        ctx.fillStyle = T.contourMajor; ctx.globalAlpha = 0.75 * alpha;
        const x0 = Math.floor((cam.x - cam.w / 2) / sp) * sp, y0 = Math.floor((cam.y - vh / k / 2) / sp) * sp;
        for (let x = x0; x < cam.x + cam.w / 2 + sp; x += sp) {
          for (let y = y0; y < cam.y + vh / k / 2 + sp; y += sp) ctx.fillRect((x - cam.x) * k + vw / 2 - 1, (y - cam.y) * k + vh / 2 - 1, 2, 2);
        }
      }
      ctx.globalAlpha = 1;
      world();
    }

    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const e of map.edges) {
      ctx.beginPath(); ctx.moveTo(e.pts[0].x, e.pts[0].y);
      for (const p of e.pts) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = T.trail; ctx.lineWidth = (e.trunk ? 1.8 : 1.4) / k;
      ctx.setLineDash(trailDash(e, k));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const e of map.edges) {
      const L = lit.get(e.id);
      if (!L || L.f <= 0) continue;
      drawPartial(ctx, e, L.f, L.rev);
      ctx.strokeStyle = T.route; ctx.lineWidth = (e.trunk ? 3.4 : 2.6) / k; ctx.stroke();
    }

    if (v.hover) {
      ctx.strokeStyle = T.route;
      for (const p of trailPath(v.hover.from, v.hover.to)) {
        if ((lit.get(p.id)?.f ?? 0) >= 1) continue;
        const e = map.byId.get(p.id)!.edge!;
        ctx.setLineDash(trailDash(e, k)); ctx.lineDashOffset = 0; ctx.lineWidth = (e.trunk ? 2.8 : 2.4) / k;
        ctx.beginPath(); e.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.lineWidth = 2.5 / k;
      const pad = 7 / k, h = v.hover.to;
      ctx.beginPath(); ctx.roundRect(h.x - h.ww / 2 - pad, h.y - h.wh / 2 - pad, h.ww + 2 * pad, h.wh + 2 * pad, 14 / k); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const n of map.nodes) {
      if (n.ww * k > 30) continue;
      ctx.beginPath(); ctx.arc(n.x, n.y, (n.level <= 2 ? 4 : 3) / k, 0, Math.PI * 2);
      ctx.fillStyle = visited.has(n.id) ? T.route : T.trail; ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Traces the walked share `f` of a trail, from whichever end it was walked from. */
function drawPartial(ctx: CanvasRenderingContext2D, e: Edge, f: number, rev: boolean): void {
  const want = f * e.len;
  ctx.beginPath();
  if (!rev) {
    ctx.moveTo(e.pts[0].x, e.pts[0].y);
    for (let i = 1; i < e.pts.length; i++) {
      const p = e.pts[i], q = e.pts[i - 1];
      if (p.l <= want) ctx.lineTo(p.x, p.y);
      else { const r = (want - q.l) / (p.l - q.l); ctx.lineTo(lerp(q.x, p.x, r), lerp(q.y, p.y, r)); break; }
    }
  } else {
    const startL = e.len - want, last = e.pts[e.pts.length - 1];
    ctx.moveTo(last.x, last.y);
    for (let i = e.pts.length - 2; i >= 0; i--) {
      const p = e.pts[i], q = e.pts[i + 1];
      if (p.l >= startL) ctx.lineTo(p.x, p.y);
      else { const r = (q.l - startL) / (q.l - p.l); ctx.lineTo(lerp(q.x, p.x, r), lerp(q.y, p.y, r)); break; }
    }
  }
}

/** The whole map, small: walked trails, and a box for what's on screen. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  readonly map: WorldMap;
  private ctx: CanvasRenderingContext2D;
  private xf = { s: 1, ox: 0, oy: 0 };

  constructor(canvas: HTMLCanvasElement, map: WorldMap) {
    this.canvas = canvas;
    this.map = map;
    this.ctx = canvas.getContext("2d")!;
  }

  draw(W: number, H: number, dpr: number, T: Tokens, lit: Lit["lit"], view: { cam: Cam; aspect: number } | null, here: string | null = null): void {
    const { ctx, map } = this, b = map.bbox, pad = 10;
    if (this.canvas.width !== Math.round(W * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    const s = Math.min((W - 2 * pad) / (b.x1 - b.x0), (H - 2 * pad) / (b.y1 - b.y0));
    const ox = pad + (W - 2 * pad - (b.x1 - b.x0) * s) / 2 - b.x0 * s, oy = pad + (H - 2 * pad - (b.y1 - b.y0) * s) / 2 - b.y0 * s;
    this.xf = { s, ox, oy };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    for (const e of map.edges) {
      const done = (lit.get(e.id)?.f ?? 0) >= 0.999;
      ctx.beginPath();
      e.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * s + ox, p.y * s + oy) : ctx.moveTo(p.x * s + ox, p.y * s + oy)));
      ctx.strokeStyle = done ? T.route : T.trail; ctx.lineWidth = done ? 2 : 1; ctx.globalAlpha = done ? 1 : 0.7;
      ctx.setLineDash(e.detour && !done ? [2, 3] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const n of map.nodes) {
      const r = n.id === here ? 3 : 1.5;
      ctx.fillStyle = n.id === here ? T.route : T.ink2;
      ctx.fillRect(n.x * s + ox - r, n.y * s + oy - r, 2 * r, 2 * r);
    }
    if (view) {
      const hw = view.cam.w / 2, hh = (view.cam.w * view.aspect) / 2;
      ctx.strokeStyle = T.ink; ctx.lineWidth = 1.2;
      ctx.strokeRect((view.cam.x - hw) * s + ox, (view.cam.y - hh) * s + oy, 2 * hw * s, 2 * hh * s);
    }
  }

  /** The stop nearest a point on the minimap, in CSS px from its corner. */
  pick(px: number, py: number): MapNode | null {
    const x = (px - this.xf.ox) / this.xf.s, y = (py - this.xf.oy) / this.xf.s;
    let best: MapNode | null = null, bd = Infinity;
    for (const n of this.map.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
    return best;
  }
}
