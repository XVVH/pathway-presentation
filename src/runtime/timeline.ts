// All motion is a pure function of time. Live presenting appends a segment each
// time you move; a tour or a video precomputes them all. Rendering only ever
// asks "where is everything at time t?", which is what makes video export work.

import type { Target } from "../payload.ts";
import { camForTarget, fitNode, type Viewport } from "./camera.ts";
import { clamp, lerp, rampEase, zoomPath, type Cam } from "./math.ts";
import { targetNode, trailPath, trailPolyline, type TrailStep, type WorldMap } from "./map.ts";

export type Profile = "cinematic" | "remote" | "reduced";

/** A skin's camera feel: speed multiplier, longest flight in seconds, and how high long jumps climb. */
export interface Flight { speed: number; max: number; rho: number }

export interface MotionContext {
  map: WorldMap;
  viewport: Viewport;
  profile: Profile;
  flight: Flight;
}

export interface Segment {
  t0: number;
  dur: number;
  from: Cam;
  to: Cam;
  /** cut: jump. fly: a camera path. fade: reduced motion. manual: dragged or zoomed by hand. */
  kind: "cut" | "fly" | "fade" | "manual";
  target: Target;
  /** Trails this move walks; they light up under the camera. */
  edges: TrailStep[];
  total: number;
  path?: (t: number) => Cam;
  ease?: (t: number) => number;
}

export interface Frame extends Cam {
  /** Card opacity: 1, except mid-way through a reduced-motion fade. */
  fade: number;
}

export interface Lit {
  /** How much of each trail is lit, by stop id, and which way it was walked. */
  lit: Map<string, { f: number; rev: boolean }>;
  /** Stops arrived at (not just passed over). */
  visited: Set<string>;
}

const RAMP = rampEase(0.34), RAMP_REMOTE = rampEase(0.22);
const linear = (t: number) => t;

export class Timeline {
  segs: Segment[];

  constructor(cam: Cam, target: Target = { kind: "map" }, walked: TrailStep[] = []) {
    this.segs = [{ t0: -1e9, dur: 0, from: cam, to: cam, kind: "cut", target, edges: walked, total: walked.reduce((a, e) => a + e.len, 0) }];
  }

  last(): Segment { return this.segs[this.segs.length - 1]; }

  segAt(t: number): [Segment, number] {
    for (let i = this.segs.length - 1; i >= 0; i--) if (this.segs[i].t0 <= t) return [this.segs[i], i];
    return [this.segs[0], 0];
  }

  camAt(t: number): Frame {
    const [s] = this.segAt(t);
    const p = s.dur > 0 ? clamp((t - s.t0) / s.dur) : 1;
    if (s.kind === "fly" && s.path) return { ...s.path((s.ease ?? linear)(p)), fade: 1 };
    if (s.kind === "fade") return { ...(p < 0.5 ? s.from : s.to), fade: Math.abs(1 - 2 * p) };
    return { ...s.to, fade: 1 };
  }

  litAt(t: number): Lit {
    const lit = new Map<string, { f: number; rev: boolean }>(), visited = new Set<string>();
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      if (s.t0 > t) break;
      const end = Math.min(t, this.segs[i + 1]?.t0 ?? Infinity);
      const p = s.dur > 0 ? clamp((end - s.t0) / s.dur) : 1;
      if (p >= 1 && s.target.kind !== "map" && s.kind !== "manual") visited.add(s.target.id);
      if (!s.total) continue;
      const litLen = (s.ease ? s.ease(p) : p) * s.total;
      let acc = 0;
      for (const e of s.edges) {
        const f = clamp((litLen - acc) / e.len);
        acc += e.len;
        const prev = lit.get(e.id);
        if (!prev || f > prev.f) lit.set(e.id, { f, rev: e.rev });
      }
    }
    return { lit, visited };
  }

  /** Trails fully walked by time t, for carrying over to a fresh timeline. */
  walkedAt(t: number, map: WorldMap): TrailStep[] {
    return [...this.litAt(t).lit].filter(([, v]) => v.f >= 1).map(([id, v]) => ({ id, len: map.byId.get(id)?.edge?.len ?? 0, rev: v.rev }));
  }
}

/** The move from wherever the camera is at t0 to `toCam`, arriving at `target`. */
export function makeSeg(tl: Timeline, t0: number, toCam: Cam, target: Target, ctx: MotionContext): Segment {
  const { map, profile, flight } = ctx;
  const { fade: _fade, ...from } = tl.camAt(t0);
  const fromTarget = tl.segAt(t0)[0].target;
  const fromNode = fromTarget.kind === "map" ? null : targetNode(map, fromTarget);
  const toNode = target.kind === "map" ? null : targetNode(map, target);
  const { lit } = tl.litAt(t0);
  const path = fromNode && toNode ? trailPath(fromNode, toNode) : [];
  const fresh = path.filter(e => (lit.get(e.id)?.f ?? 0) < 1);
  const base = { t0, from, to: toCam, target, edges: fresh, total: fresh.reduce((a, e) => a + e.len, 0) };
  if (profile === "reduced") return { ...base, dur: 0.45, kind: "fade", ease: linear };
  const remote = profile === "remote";

  // Neighbouring stops: ride the trail itself. The camera eases in, cruises
  // along the curve, rises a little mid-way to show the land around, and eases
  // out. The route line draws exactly under the camera.
  if (fromTarget.kind === "stop" && target.kind === "stop" && fromNode && toNode && path.length && path.length <= 3) {
    const home = fitNode(ctx.viewport, fromNode);
    const atHome = Math.hypot(from.x - home.x, from.y - home.y) < 0.2 * from.w && Math.abs(Math.log(from.w / home.w)) < 0.3;
    const poly = trailPolyline(map, path);
    if (atHome && poly.len <= 2.6 * Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y) + 1) {
      const screens = poly.len / Math.sqrt(from.w * toCam.w);
      const lift = remote ? 0 : clamp(0.08 + 0.14 * screens, 0.08, 0.3);
      const o0 = { x: from.x - fromNode.x, y: from.y - fromNode.y }, o1 = { x: toCam.x - toNode.x, y: toCam.y - toNode.y };
      const lw0 = Math.log(from.w), lw1 = Math.log(toCam.w);
      const f = (e: number): Cam => {
        const P = poly.at(e * poly.len);
        return { x: P.x + lerp(o0.x, o1.x, e), y: P.y + lerp(o0.y, o1.y, e), w: Math.exp(lerp(lw0, lw1, e)) * (1 + lift * Math.sin(Math.PI * e)) };
      };
      const dur = remote ? clamp(0.45 + 0.22 * screens, 0.55, 0.9) : clamp(1.15 + 0.6 * screens, 1.6, flight.max) / flight.speed;
      return { ...base, kind: "fly", path: f, dur, ease: remote ? RAMP_REMOTE : RAMP, edges: path, total: poly.len };
    }
  }
  // Longer jumps climb toward the ground the two ends share, then descend.
  const zp = zoomPath(from, toCam, remote ? 1.05 : flight.rho);
  let dur = remote ? clamp(0.4 + zp.S * 0.18, 0.5, 0.9) : clamp(0.6 + zp.S * 0.8, 1.3, flight.max) / flight.speed;
  if (!(zp.S > 1e-4)) dur = 0.01;
  return { ...base, kind: "fly", path: zp.f, dur, ease: remote ? RAMP_REMOTE : RAMP };
}

/** Appends the move to `target` at time t, framed for this viewport. */
export function flyTo(tl: Timeline, t: number, target: Target, ctx: MotionContext, cam = camForTarget(ctx.viewport, ctx.map, target)): Segment {
  const seg = makeSeg(tl, t, cam, target, ctx);
  tl.segs.push(seg);
  return seg;
}
