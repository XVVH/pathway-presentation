// Framing: how big a card is at reading size on this screen, and where the
// camera sits to show a stop, a branch, or the whole map.

import type { Target } from "../payload.ts";
import type { Cam } from "./math.ts";
import type { MapNode, Rect, WorldMap } from "./map.ts";

export interface Viewport {
  /** Screen size in CSS px. */
  vw: number;
  vh: number;
  /** The part of the screen left for content once the HUD takes its strips. */
  frame: { x: number; y: number; w: number; h: number };
  /** Width of a trunk card at reading size, in CSS px. */
  cw: number;
}

export interface Insets { top: number; bottom: number }

/** The HUD's crumbs sit above the content, the status and controls below. */
export const HUD_INSETS: Insets = { top: 58, bottom: 70 };

export function viewport(vw: number, vh: number, insets: Insets = HUD_INSETS): Viewport {
  const frame = { x: 0, y: insets.top, w: vw, h: Math.max(120, vh - insets.top - insets.bottom) };
  // A card takes most of a portrait screen's width, and 60% of a landscape one,
  // leaving the land around it in view.
  const cw = Math.max(1, Math.floor(Math.min(vw * (vw < vh ? 0.86 : 0.6), frame.h * 0.8 * 1.6)));
  return { vw, vh, frame, cw };
}

/** The camera that puts world point (cx, cy) in the middle of the frame at scale k. */
export function camFor(v: Viewport, cx: number, cy: number, k: number): Cam {
  const fx = v.frame.x + v.frame.w / 2, fy = v.frame.y + v.frame.h / 2;
  return { x: cx - (fx - v.vw / 2) / k, y: cy - (fy - v.vh / 2) / k, w: v.vw / k };
}

/** A stop at reading size: its card exactly `cw` wide, unless that's too tall to fit. */
export function fitNode(v: Viewport, n: MapNode): Cam {
  return camFor(v, n.x, n.y, Math.min(v.cw / n.ww, (v.frame.h * 0.94) / n.wh));
}

export function fitBox(v: Viewport, b: Rect, pad = 1.12): Cam {
  const w = (b.x1 - b.x0) * pad, h = (b.y1 - b.y0) * pad;
  return camFor(v, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.min(v.frame.w / w, v.frame.h / h));
}

export function camForTarget(v: Viewport, map: WorldMap, t: Target): Cam {
  if (t.kind === "map") return fitBox(v, map.bbox, 1.06);
  const n = map.byId.get(t.id) ?? map.root;
  return t.kind === "lookback" ? fitBox(v, n.bbox, 1.14) : fitNode(v, n);
}

/** How far you can zoom: a little closer than reading size, and out to well past the whole map. */
export function clampWidth(v: Viewport, map: WorldMap, w: number): number {
  const minW = (Math.min(...map.nodes.map(n => n.ww)) * v.vw) / v.cw * 0.6;
  const maxW = (map.bbox.x1 - map.bbox.x0) * 2.2;
  return Math.min(maxW, Math.max(minW, w));
}
