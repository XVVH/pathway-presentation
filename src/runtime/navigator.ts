// Where you are in the talk, and where each key takes you. The route is a list
// of targets; you can leave it (a detour, a click, a drag) and rejoin it where
// you left. This decides where to go; the timeline decides how to get there.

import type { Target } from "../payload.ts";
import { targetNode, type MapNode, type WorldMap } from "./map.ts";

export interface Excursion {
  /** The detour and everything under it, in reading order. */
  stops: Target[];
  i: number;
  detour: string;
}

export const stopTarget = (id: string): Target => ({ kind: "stop", id });

/** A detour's own little route: the detour, then its children, pulling back after branches. */
export function excursionRoute(d: MapNode): Target[] {
  const out: Target[] = [stopTarget(d.id)];
  (function walk(n: MapNode) {
    for (const c of n.seq) {
      out.push(stopTarget(c.id));
      if (c.seq.length) {
        walk(c);
        if (out[out.length - 1].kind === "lookback") out.pop();
        out.push({ kind: "lookback", id: c.id });
      }
    }
  })(d);
  return out;
}

/** Detours one key away from a stop: its own, and its siblings'. */
export function detoursFrom(n: MapNode): MapNode[] {
  const pool = [...n.children.filter(c => c.detour), ...(n.parent ? n.parent.children.filter(c => c.detour && c !== n) : [])];
  return [...new Set(pool)];
}

export const sameTarget = (a: Target | undefined, b: Target | undefined) =>
  !!a && !!b && a.kind === b.kind && (a.kind === "map" || a.id === (b as { id: string }).id);

export class Navigator {
  readonly map: WorldMap;
  readonly routes: ReadonlyMap<string | null, Target[]>;
  routeName: string | null = null;
  route: Target[];
  ri = 0;
  offRoute = false;
  excursion: Excursion | null = null;
  /** Where the camera was last sent. Dragging keeps it, but leaves the route. */
  here: Target;

  /** `routes` maps null to the default route, and each name to a named route. */
  constructor(map: WorldMap, routes: ReadonlyMap<string | null, Target[]>) {
    this.map = map;
    this.routes = routes;
    this.route = routes.get(null) ?? [{ kind: "map" }];
    this.here = this.route[0];
  }

  current(): Target {
    return this.excursion ? this.excursion.stops[this.excursion.i] : this.offRoute ? this.here : this.route[this.ri];
  }

  currentNode(): MapNode { return targetNode(this.map, this.current()); }

  /** The next target on the route, which → goes to (or rejoins at). */
  ahead(): Target | undefined { return this.route[this.ri + 1]; }

  detours(): MapNode[] { return this.excursion ? [] : detoursFrom(this.currentNode()); }

  goTo(i: number): Target {
    this.ri = Math.min(this.route.length - 1, Math.max(0, i));
    this.offRoute = false;
    this.excursion = null;
    return (this.here = this.route[this.ri]);
  }

  next(): Target {
    const x = this.excursion;
    if (x && x.i + 1 < x.stops.length) { x.i++; return (this.here = x.stops[x.i]); }
    return this.goTo(this.ri + 1);
  }

  /** Back one stop, or back to where you left the route. */
  prev(): Target {
    if (this.excursion || this.offRoute) return this.goTo(this.ri);
    return this.goTo(this.ri - 1);
  }

  takeDetour(id: string): Target | null {
    const d = this.map.byId.get(id);
    if (!d) return null;
    this.excursion = { stops: excursionRoute(d), i: 0, detour: d.id };
    this.offRoute = true;
    return (this.here = this.excursion.stops[0]);
  }

  /** ↓: the detour offered here, or else down into this stop's branch. */
  dive(): Target | null {
    const n = this.currentNode(), ds = this.detours();
    if (ds.length) return this.takeDetour(ds[0].id);
    const first = n.seq[0];
    if (!first) return null;
    const j = this.route.findIndex(s => s.kind === "stop" && s.id === first.id);
    return j >= 0 ? this.goTo(j) : null;
  }

  /** ↑: out of a detour, or back far enough to see the branch you're on. */
  surface(): Target {
    if (this.excursion) return this.goTo(this.ri);
    const n = this.currentNode(), t = this.current();
    this.offRoute = true;
    if (t.kind === "stop" && n.seq.length) return (this.here = { kind: "lookback", id: n.id });
    if (n.parent && n.parent !== this.map.root) return (this.here = { kind: "lookback", id: n.parent.id });
    return (this.here = { kind: "map" });
  }

  showMap(): Target {
    this.excursion = null;
    const at = this.route[this.ri];
    this.offRoute = this.ri !== 0 && !(at.kind === "map" && at.final);
    return (this.here = { kind: "map" });
  }

  /**
   * A click on a stop: always a look, never a change of place. → rejoins the
   * route where you left it, wherever the stop is, so the key always does what
   * the status line says. Clicking the stop you left from is rejoining.
   */
  visit(id: string): Target | null {
    if (!this.map.byId.has(id)) return null;
    const t = stopTarget(id);
    if (sameTarget(this.route[this.ri], t)) return this.goTo(this.ri);
    this.excursion = null;
    this.offRoute = true;
    return (this.here = t);
  }

  /** Moves your place on the route to this target. Null when the route doesn't pass it. */
  continueFrom(t: Target): Target | null {
    const j = this.route.findIndex(s => sameTarget(s, t));
    return j >= 0 ? this.goTo(j) : null;
  }

  /** True when you've looked away to a target the route passes, so C can make it your place. */
  canContinueHere(): boolean {
    if (!this.offRoute) return false;
    const t = this.current();
    return this.route.some((s, j) => j !== this.ri && sameTarget(s, t));
  }

  /** C: carry on the talk from what you're looking at, instead of going back. */
  continueHere(): Target | null {
    return this.canContinueHere() ? this.continueFrom(this.current()) : null;
  }

  /** The camera was moved by hand. */
  manual(): void {
    this.offRoute = true;
    this.excursion = null;
  }

  /** Switches route. Stays put if this stop is on the new route; otherwise starts it from the top. */
  useRoute(name: string | null): Target | null {
    const route = this.routes.get(name);
    if (!route) return null;
    const here = this.current();
    this.routeName = name;
    this.route = route;
    const j = route.findIndex(s => sameTarget(s, here));
    if (j >= 0) { this.ri = j; this.offRoute = false; this.excursion = null; return null; }
    return this.goTo(0);
  }

  /** The stops a viewer reads on this route, in order: what "stop 3 of 9" counts. */
  stations(): string[] {
    const root = this.map.root.id;
    return this.route.flatMap(s => (s.kind === "stop" && s.id !== root ? [s.id] : []));
  }
}
