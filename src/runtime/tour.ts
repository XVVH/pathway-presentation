// A tour plays a route by itself: every move and every pause precomputed on one
// timeline, so it can be scrubbed, or stepped frame by frame into a video.

import type { Target } from "../payload.ts";
import { camForTarget } from "./camera.ts";
import { clamp } from "./math.ts";
import { Timeline, makeSeg, type MotionContext } from "./timeline.ts";

export interface Tour {
  tl: Timeline;
  /** When the camera arrives at each target. */
  arrivals: { t: number; target: Target }[];
  duration: number;
}

/** Seconds to rest at a target: longer for more words, and for video. */
export function holdFor(t: Target, ctx: Pick<MotionContext, "map">): number {
  if (t.kind === "map") return t.final ? 4.2 : 2.6;
  if (t.kind === "lookback") return 2.0;
  const n = ctx.map.byId.get(t.id);
  if (!n || n === ctx.map.root) return 3.2;
  const video = n.stop.figures.some(f => f.kind === "video");
  return clamp(1.7 + n.stop.words * 0.075, 2.4, 4.6) + (video ? 2 : 0);
}

export function buildTour(route: readonly Target[], ctx: MotionContext): Tour {
  const first = route[0] ?? { kind: "map" };
  const tl = new Timeline(camForTarget(ctx.viewport, ctx.map, first), first);
  const arrivals = [{ t: 0, target: first }];
  let t = holdFor(first, ctx);
  for (let i = 1; i < route.length; i++) {
    const seg = makeSeg(tl, t, camForTarget(ctx.viewport, ctx.map, route[i]), route[i], ctx);
    tl.segs.push(seg);
    arrivals.push({ t: t + seg.dur, target: route[i] });
    t += seg.dur + holdFor(route[i], ctx);
  }
  return { tl, arrivals, duration: t };
}
