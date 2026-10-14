// The map: where every stop sits, and the trails between them. There are no
// coordinates in a deck; this is where they come from.
//
// The trunk runs east with a meander. Each trunk stop sends its branch up or
// down, alternating: it leaves steeply and bends downstream, the way a road
// climbs out of a valley. Deeper detail starts forward and bends away from the
// trunk. Each stop is placed from the previous one along the current heading,
// then slid forward until it touches nothing, so curves can never collide.

import type { Bend, PayloadStop } from "../payload.ts";
import { clamp, DEG, lerp } from "./math.ts";

/** World width of a trunk card. Everything else is relative to it. */
export const BASE_W = 1600;

export interface BendSpec {
  trunkAmp: number; trunkFreq: number;
  branchStart: number; branchTurn: number; branchMin: number;
  subStart: number; subTurn: number;
  /** Bezier control length as a share of the distance between stops. */
  ctrl: number;
}

export const BENDS: Record<Bend, BendSpec> = {
  gentle: { trunkAmp: 0.14, trunkFreq: 1.9, branchStart: 72, branchTurn: 19, branchMin: 8, subStart: 45, subTurn: 13, ctrl: 1 / 3 },
  bold: { trunkAmp: 0.3, trunkFreq: 1.7, branchStart: 88, branchTurn: 27, branchMin: 4, subStart: 70, subTurn: 22, ctrl: 0.42 },
  winding: { trunkAmp: 0.48, trunkFreq: 1.35, branchStart: 100, branchTurn: 31, branchMin: 0, subStart: 88, subTurn: 27, ctrl: 0.5 },
};

/** Cards shrink with distance from the trunk. */
export const LEVEL_SCALE: Record<number, number> = { 1: 1, 2: 1, 3: 0.62, 4: 0.42, 5: 0.3, 6: 0.22 };

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface TrailPoint { x: number; y: number; l: number }

/** The trail into a stop, from the one before it in its parent's sequence. */
export interface Edge {
  /** The id of the stop the trail leads to. */
  id: string;
  from: MapNode;
  to: MapNode;
  pts: TrailPoint[];
  len: number;
  trunk: boolean;
  detour: boolean;
}

export interface MapNode {
  id: string;
  stop: PayloadStop;
  level: number;
  detour: boolean;
  parent: MapNode | null;
  children: MapNode[];
  /** Children in trail order: the route's stops first, then detours. */
  seq: MapNode[];
  /** World size of the card. */
  ww: number;
  wh: number;
  /** World position of the card's centre. */
  x: number;
  y: number;
  heading: number;
  side: number;
  edge: Edge | null;
  /** The stop the trail into this one comes from. */
  trailParent: MapNode | null;
  /** This stop and everything below it. */
  bbox: Rect;
}

export interface WorldMap {
  root: MapNode;
  nodes: MapNode[];
  byId: Map<string, MapNode>;
  edges: Edge[];
  bbox: Rect;
}

export function createMap(stops: readonly PayloadStop[]): WorldMap {
  if (!stops.length) throw new Error("A map needs at least one stop.");
  const byId = new Map<string, MapNode>();
  const nodes = stops.map(stop => {
    const s = LEVEL_SCALE[stop.level] ?? 0.2;
    const node: MapNode = {
      id: stop.id, stop, level: stop.level, detour: stop.detour, parent: null, children: [], seq: [],
      ww: BASE_W * s, wh: BASE_W * s * stop.ratio, x: 0, y: 0, heading: 0, side: 1,
      edge: null, trailParent: null, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
    };
    byId.set(stop.id, node);
    return node;
  });
  for (const n of nodes) {
    n.parent = n.stop.parent ? byId.get(n.stop.parent) ?? null : null;
    n.children = n.stop.children.map(id => byId.get(id)).filter((c): c is MapNode => !!c);
    n.seq = [...n.children.filter(c => !c.detour), ...n.children.filter(c => c.detour)];
  }
  return { root: nodes[0], nodes, byId, edges: [], bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } };
}

interface Box { x: number; y: number; w: number; h: number }

function overlaps(a: Box, b: Box, g: number): boolean {
  return a.x < b.x + b.w + g && a.x + a.w + g > b.x && a.y < b.y + b.h + g && a.y + a.h + g > b.y;
}

/** How far to move `a` along `u` so it clears `b` by the gap `g`. */
function sepDelta(a: Box, b: Box, u: { x: number; y: number }, g: number): number {
  let best = Infinity;
  if (u.x > 1e-6) best = Math.min(best, (b.x + b.w + g - a.x) / u.x);
  if (u.x < -1e-6) best = Math.min(best, (b.x - g - (a.x + a.w)) / u.x);
  if (u.y > 1e-6) best = Math.min(best, (b.y + b.h + g - a.y) / u.y);
  if (u.y < -1e-6) best = Math.min(best, (b.y - g - (a.y + a.h)) / u.y);
  return best;
}

/** Places every stop and draws the trails. Deterministic for a deck and a bend. */
export function layoutMap(map: WorldMap, bend: Bend): void {
  const B = BENDS[bend];
  const { root, nodes } = map;
  const local = new Map<MapNode, { x: number; y: number }>();
  root.heading = 0;
  let side = 1;

  function headingsFor(n: MapNode): number[] {
    if (n.level === 1) return n.seq.map((_, i) => B.trunkAmp * Math.sin(i * B.trunkFreq + 0.5));
    if (n.level === 2) { side = -side; n.side = side; } else n.side = n.parent?.side ?? 1;
    const s = n.side, h = n.heading;
    if (n.level === 2) {
      return n.seq.map((_, i) => {
        const a = h + s * (B.branchStart - B.branchTurn * i) * DEG;
        return s > 0 ? Math.max(a, h + B.branchMin * DEG) : Math.min(a, h - B.branchMin * DEG);
      });
    }
    return n.seq.map((_, i) => {
      const a = h - s * B.subStart * DEG + s * B.subTurn * i * DEG;
      return s > 0 ? Math.min(a, h) : Math.max(a, h);
    });
  }

  // Lays out a subtree around its own origin; returns the boxes it occupies.
  function shape(n: MapNode): Box[] {
    const rects: Box[] = [{ x: -n.ww / 2, y: -n.wh / 2, w: n.ww, h: n.wh }];
    if (!n.seq.length) return rects;
    const hs = headingsFor(n);
    n.seq.forEach((c, k) => { c.heading = hs[k]; });
    const g = 0.3 * n.seq[0].ww;
    let px = 0, py = 0;
    n.seq.forEach((c, k) => {
      const cr = shape(c);
      const u = { x: Math.cos(hs[k]), y: Math.sin(hs[k]) };
      let t = 0;
      for (let iter = 0; iter < 400; iter++) {
        const ox = px + u.x * t, oy = py + u.y * t;
        let delta = 0;
        for (const r of cr) {
          const a = { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h };
          for (const b of rects) if (overlaps(a, b, g)) delta = Math.max(delta, sepDelta(a, b, u, g));
        }
        if (delta <= 0) break;
        t += delta + 1;
      }
      const lx = px + u.x * t, ly = py + u.y * t;
      local.set(c, { x: lx, y: ly });
      for (const r of cr) rects.push({ x: r.x + lx, y: r.y + ly, w: r.w, h: r.h });
      px = lx; py = ly;
    });
    return rects;
  }
  shape(root);
  (function place(n: MapNode, x: number, y: number) {
    n.x = x; n.y = y;
    for (const c of n.children) { const l = local.get(c)!; place(c, x + l.x, y + l.y); }
  })(root, 0, 0);

  // Trails: each sequence is a smooth chain from its parent through its
  // children, with tangents taken from the headings so the curves flow.
  const edges: Edge[] = [];
  for (const n of nodes) {
    n.edge = null; n.trailParent = null;
  }
  for (const n of nodes) {
    if (!n.seq.length) continue;
    const hs = n.seq.map(c => c.heading);
    let prev = n;
    n.seq.forEach((c, k) => {
      const h0 = k === 0 ? hs[0] : (hs[k - 1] + hs[k]) / 2;
      const h1 = k === hs.length - 1 ? hs[k] : (hs[k] + hs[k + 1]) / 2;
      const a = { x: prev.x, y: prev.y }, b = { x: c.x, y: c.y };
      const d = Math.hypot(b.x - a.x, b.y - a.y) * B.ctrl;
      const p1 = { x: a.x + Math.cos(h0) * d, y: a.y + Math.sin(h0) * d };
      const p2 = { x: b.x - Math.cos(h1) * d, y: b.y - Math.sin(h1) * d };
      const pts: TrailPoint[] = [];
      let len = 0;
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, mt = 1 - t;
        const x = mt * mt * mt * a.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * b.x;
        const y = mt * mt * mt * a.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * b.y;
        if (pts.length) len += Math.hypot(x - pts[pts.length - 1].x, y - pts[pts.length - 1].y);
        pts.push({ x, y, l: len });
      }
      const e: Edge = { id: c.id, from: prev, to: c, pts, len, trunk: n.level === 1, detour: c.detour };
      c.edge = e; c.trailParent = prev;
      edges.push(e);
      prev = c;
    });
  }
  map.edges = edges;
  for (const n of [...nodes].reverse()) {
    let b = { x0: n.x - n.ww / 2, y0: n.y - n.wh / 2, x1: n.x + n.ww / 2, y1: n.y + n.wh / 2 };
    for (const c of n.children) b = { x0: Math.min(b.x0, c.bbox.x0), y0: Math.min(b.y0, c.bbox.y0), x1: Math.max(b.x1, c.bbox.x1), y1: Math.max(b.y1, c.bbox.y1) };
    n.bbox = b;
  }
  map.bbox = root.bbox;
}

/** One trail walked forwards or backwards. */
export interface TrailStep { id: string; len: number; rev: boolean }

/** The trails from one stop to another: back up to where they meet, then out. */
export function trailPath(a: MapNode | null, b: MapNode | null): TrailStep[] {
  if (!a || !b || a === b) return [];
  const chain = (n: MapNode | null) => { const c: MapNode[] = []; while (n) { c.push(n); n = n.trailParent; } return c; };
  const ca = chain(a), cb = chain(b), setB = new Set(cb);
  const meet = ca.find(n => setB.has(n));
  const up: TrailStep[] = [], down: TrailStep[] = [];
  for (const n of ca) { if (n === meet) break; up.push({ id: n.id, len: n.edge!.len, rev: true }); }
  for (const n of cb) { if (n === meet) break; down.unshift({ id: n.id, len: n.edge!.len, rev: false }); }
  return [...up, ...down];
}

export interface Polyline {
  len: number;
  at(s: number): { x: number; y: number };
}

/** A walk along trails as one curve, measured by length. */
export function trailPolyline(map: WorldMap, path: readonly TrailStep[]): Polyline {
  const pts: TrailPoint[] = [];
  for (const step of path) {
    const src = map.byId.get(step.id)!.edge!.pts;
    const seq = step.rev ? [...src].reverse() : src;
    for (const p of seq) {
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - p.x) + Math.abs(last.y - p.y) < 1e-6) continue;
      pts.push({ x: p.x, y: p.y, l: 0 });
    }
  }
  for (let i = 1; i < pts.length; i++) pts[i].l = pts[i - 1].l + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const len = pts.length ? pts[pts.length - 1].l : 0;
  return {
    len,
    at(s) {
      if (pts.length < 2) return pts[0] ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].l < s) lo = mid; else hi = mid; }
      const a = pts[lo], b = pts[hi], r = b.l > a.l ? clamp((s - a.l) / (b.l - a.l)) : 0;
      return { x: lerp(a.x, b.x, r), y: lerp(a.y, b.y, r) };
    },
  };
}

/** The node a target is about: the stop, the branch looked back over, or the title for the map. */
export function targetNode(map: WorldMap, t: { kind: string; id?: string }): MapNode {
  return (t.kind !== "map" && t.id ? map.byId.get(t.id) : undefined) ?? map.root;
}
