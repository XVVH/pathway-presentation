import assert from "node:assert/strict";
import { test } from "node:test";
import type { PayloadStop, Target } from "../src/payload.ts";
import { camForTarget, fitNode, viewport } from "../src/runtime/camera.ts";
import { createMap, layoutMap, trailPath, trailPolyline, type WorldMap } from "../src/runtime/map.ts";
import { rampEase, zoomPath } from "../src/runtime/math.ts";
import { Navigator, excursionRoute } from "../src/runtime/navigator.ts";
import { buildTerrain } from "../src/runtime/terrain.ts";
import { Timeline, flyTo, type MotionContext } from "../src/runtime/timeline.ts";
import { buildTour } from "../src/runtime/tour.ts";

/** Stops from an outline: each line is "  id" indented two spaces per level, "*" marks a detour. */
function stops(outline: string): PayloadStop[] {
  const out: PayloadStop[] = [];
  const stack: PayloadStop[] = [];
  for (const raw of outline.trim().split("\n")) {
    const level = (raw.length - raw.trimStart().length) / 2 + 1;
    const name = raw.trim(), detour = name.endsWith("*"), id = name.replace("*", "");
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const s: PayloadStop = { id, title: id, level, parent: parent?.id ?? null, children: [], detour, number: null, ratio: 0.5, density: "talk", words: 20, body: "", figures: [] };
    parent?.children.push(id);
    out.push(s);
    stack.push(s);
  }
  return out;
}

const DECK = `
title
  a
    a1
    a2
      a2x
    a3*
  b
    b1
  c*
    c1
  d
`;

function world(bend: "gentle" | "bold" | "winding" = "bold"): WorldMap {
  const map = createMap(stops(DECK));
  layoutMap(map, bend);
  return map;
}

const DEFAULT: Target[] = [
  { kind: "map" }, { kind: "stop", id: "title" },
  { kind: "stop", id: "a" }, { kind: "stop", id: "a1" }, { kind: "stop", id: "a2" }, { kind: "stop", id: "a2x" }, { kind: "lookback", id: "a" },
  { kind: "stop", id: "b" }, { kind: "stop", id: "b1" }, { kind: "lookback", id: "b" },
  { kind: "stop", id: "d" }, { kind: "map", final: true },
];

const overlap = (a: { x: number; y: number; ww: number; wh: number }, b: typeof a) =>
  Math.abs(a.x - b.x) < (a.ww + b.ww) / 2 && Math.abs(a.y - b.y) < (a.wh + b.wh) / 2;

test("layout: no two cards overlap, for every bend", () => {
  for (const bend of ["gentle", "bold", "winding"] as const) {
    const map = world(bend);
    for (const a of map.nodes) for (const b of map.nodes) if (a !== b) assert.ok(!overlap(a, b), `${bend}: ${a.id} overlaps ${b.id}`);
  }
});

test("layout: the trunk runs east, cards shrink with depth, branches alternate sides", () => {
  const map = world();
  const [a, b, d] = ["a", "b", "d"].map(id => map.byId.get(id)!);
  assert.ok(a.x < b.x && b.x < d.x);
  assert.equal(map.byId.get("a1")!.ww, a.ww * 0.62);
  assert.equal(map.byId.get("a2x")!.ww, a.ww * 0.42);
  assert.ok(Math.sign(map.byId.get("a1")!.y - a.y) !== Math.sign(map.byId.get("b1")!.y - b.y));
});

test("layout: is deterministic, and every card fits inside the map's box", () => {
  const m1 = world(), m2 = world();
  assert.deepEqual(m1.nodes.map(n => [n.x, n.y]), m2.nodes.map(n => [n.x, n.y]));
  for (const n of m1.nodes) {
    assert.ok(n.x - n.ww / 2 >= m1.bbox.x0 - 1e-6 && n.x + n.ww / 2 <= m1.bbox.x1 + 1e-6);
    assert.ok(n.y - n.wh / 2 >= m1.bbox.y0 - 1e-6 && n.y + n.wh / 2 <= m1.bbox.y1 + 1e-6);
  }
});

test("trails: one per stop below the title, ending on the stop", () => {
  const map = world();
  assert.equal(map.edges.length, map.nodes.length - 1);
  for (const e of map.edges) {
    const end = e.pts[e.pts.length - 1];
    assert.ok(Math.hypot(end.x - e.to.x, end.y - e.to.y) < 1e-6);
    assert.ok(e.len > 0);
  }
  // Siblings chain: a2's trail starts at a1, not at a.
  assert.equal(map.byId.get("a2")!.trailParent!.id, "a1");
});

test("trailPath goes back to where two trails meet, then out", () => {
  const map = world();
  const path = trailPath(map.byId.get("a2x")!, map.byId.get("b1")!);
  assert.deepEqual(path.map(p => `${p.rev ? "-" : "+"}${p.id}`), ["-a2x", "-a2", "-a1", "+b", "+b1"]);
  const poly = trailPolyline(map, path);
  assert.ok(Math.abs(poly.len - path.reduce((s, p) => s + p.len, 0)) < 1e-3);
  const start = poly.at(0), end = poly.at(poly.len);
  assert.ok(Math.hypot(start.x - map.byId.get("a2x")!.x, start.y - map.byId.get("a2x")!.y) < 1e-6);
  assert.ok(Math.hypot(end.x - map.byId.get("b1")!.x, end.y - map.byId.get("b1")!.y) < 1e-6);
});

test("terrain: contour segments surround the map, and the same seed gives the same land", () => {
  const map = world();
  const t1 = buildTerrain(map, 7), t2 = buildTerrain(map, 7);
  assert.ok(t1.minor.length > 400 && t1.major.length > 40);
  assert.equal(t1.minor.length % 4, 0);
  assert.deepEqual(t1.minor.slice(0, 40), t2.minor.slice(0, 40));
});

test("camera: a stop at reading size is exactly a card width across", () => {
  const map = world(), v = viewport(1280, 720);
  const n = map.byId.get("a")!, cam = fitNode(v, n);
  assert.ok(Math.abs((n.ww * v.vw) / cam.w - v.cw) < 1e-6);
  const whole = camForTarget(v, map, { kind: "map" });
  assert.ok(whole.w >= map.bbox.x1 - map.bbox.x0);
});

test("easing: the ramp starts and ends at rest and is monotonic", () => {
  const e = rampEase(0.34);
  assert.equal(e(0), 0);
  assert.ok(Math.abs(e(1) - 1) < 1e-9);
  for (let t = 0; t < 1; t += 0.01) assert.ok(e(t + 0.01) >= e(t) - 1e-12);
  assert.ok(e(0.01) < 0.01, "starts slowly");
});

test("zoomPath lands exactly on both ends", () => {
  const a = { x: 0, y: 0, w: 1000 }, b = { x: 5000, y: 1200, w: 800 };
  const zp = zoomPath(a, b, Math.SQRT2);
  for (const [t, want] of [[0, a], [1, b]] as const) {
    const c = zp.f(t);
    assert.ok(Math.abs(c.x - want.x) < 1e-6 && Math.abs(c.y - want.y) < 1e-6 && Math.abs(c.w - want.w) < 1e-6);
  }
  assert.ok(zp.f(0.5).w > a.w, "rises mid-way");
});

function ctx(map: WorldMap, profile: MotionContext["profile"] = "cinematic"): MotionContext {
  return { map, viewport: viewport(1280, 720), profile, flight: { speed: 1, max: 3.6, rho: Math.SQRT2 } };
}

test("timeline: neighbours ride the trail and light it; arrival marks the stop visited", () => {
  const map = world(), c = ctx(map);
  const tl = new Timeline(camForTarget(c.viewport, map, { kind: "stop", id: "a" }), { kind: "stop", id: "a" });
  const seg = flyTo(tl, 10, { kind: "stop", id: "a1" }, c);
  assert.equal(seg.kind, "fly");
  assert.deepEqual(seg.edges.map(e => e.id), ["a1"]);
  assert.ok(seg.dur >= 1.6 && seg.dur <= 3.6);
  const mid = tl.litAt(10 + seg.dur / 2);
  assert.ok(mid.lit.get("a1")!.f > 0 && mid.lit.get("a1")!.f < 1);
  assert.ok(!mid.visited.has("a1"));
  const after = tl.litAt(10 + seg.dur + 0.01);
  assert.equal(after.lit.get("a1")!.f, 1);
  assert.ok(after.visited.has("a1"));
  const end = tl.camAt(10 + seg.dur);
  const want = fitNode(c.viewport, map.byId.get("a1")!);
  assert.ok(Math.abs(end.x - want.x) < 1e-6 && Math.abs(end.w - want.w) < 1e-6);
});

test("timeline: remote moves are short; reduced motion fades", () => {
  const map = world();
  for (const [profile, kind, max] of [["remote", "fly", 0.9], ["reduced", "fade", 0.45]] as const) {
    const c = ctx(map, profile);
    const tl = new Timeline(camForTarget(c.viewport, map, { kind: "map" }));
    const seg = flyTo(tl, 0, { kind: "stop", id: "d" }, c);
    assert.equal(seg.kind, kind);
    assert.ok(seg.dur <= max);
  }
});

test("navigator: →, detours, ↑ and rejoining", () => {
  const map = world();
  const nav = new Navigator(map, new Map([[null, DEFAULT]]));
  const keys: string[] = [];
  const go = (t: Target | null) => keys.push(t ? (t.kind === "map" ? "map" : `${t.kind === "lookback" ? "^" : ""}${t.id}`) : "-");
  for (let i = 0; i < 5; i++) go(nav.next());
  assert.deepEqual(keys, ["title", "a", "a1", "a2", "a2x"]);
  // The detour a3 is a sibling of a2, so it's offered at a2 but not below it.
  assert.deepEqual(nav.detours().map(n => n.id), []);
  go(nav.prev());
  assert.deepEqual(nav.detours().map(n => n.id), ["a3"]);
  go(nav.dive());
  assert.equal(nav.excursion?.detour, "a3");
  assert.equal(nav.ahead()?.kind, "stop");
  go(nav.next()); // the detour has no children, so → rejoins the route
  assert.deepEqual(keys.slice(-3), ["a2", "a3", "a2x"]);
  go(nav.surface());
  assert.deepEqual(keys.slice(-1), ["^a2"]);
  assert.ok(nav.offRoute);
  go(nav.next());
  assert.deepEqual(keys.slice(-1), ["^a"]);
});

test("navigator: a click is a look; → comes back wherever the stop is", () => {
  const map = world();
  const nav = new Navigator(map, new Map([[null, DEFAULT]]));
  nav.next(); nav.next(); // the title, then a
  for (const id of ["b1", "c1", "a2x", "title"]) {
    nav.visit(id);
    assert.equal(nav.offRoute, true, id);
  }
  assert.deepEqual(nav.next(), { kind: "stop", id: "a1" }, "rejoins after a");
  nav.visit("d");
  assert.deepEqual(nav.prev(), { kind: "stop", id: "a1" }, "← goes back to where you left");
  nav.visit("d");
  assert.deepEqual(nav.visit("a1"), { kind: "stop", id: "a1" });
  assert.equal(nav.offRoute, false, "clicking the stop you left from is rejoining");
});

test("navigator: C carries on from a stop the route passes, and only then", () => {
  const map = world();
  const nav = new Navigator(map, new Map([[null, DEFAULT]]));
  nav.next(); nav.next();
  assert.equal(nav.canContinueHere(), false, "on the route already");
  nav.visit("b1");
  assert.equal(nav.canContinueHere(), true);
  assert.deepEqual(nav.continueHere(), { kind: "stop", id: "b1" });
  assert.equal(nav.offRoute, false);
  assert.deepEqual(nav.next(), { kind: "lookback", id: "b" });
  nav.visit("c1"); // under a detour: the route doesn't pass it
  assert.equal(nav.canContinueHere(), false);
  assert.equal(nav.continueHere(), null);
  assert.deepEqual(nav.next(), { kind: "stop", id: "d" });
  // A pull-back the route makes is a place you can carry on from too...
  nav.visit("b1");
  nav.surface();
  assert.deepEqual(nav.current(), { kind: "lookback", id: "b" });
  assert.equal(nav.canContinueHere(), true);
  // ...but not one it doesn't.
  nav.visit("a2x");
  nav.surface();
  assert.deepEqual(nav.current(), { kind: "lookback", id: "a2" });
  assert.equal(nav.canContinueHere(), false);
});

test("navigator: switching routes keeps your place when it can", () => {
  const map = world();
  const exec: Target[] = [{ kind: "map" }, { kind: "stop", id: "title" }, { kind: "stop", id: "b" }, { kind: "stop", id: "d" }, { kind: "map", final: true }];
  const nav = new Navigator(map, new Map([[null, DEFAULT], ["exec", exec]]));
  nav.continueFrom({ kind: "stop", id: "b" });
  assert.equal(nav.useRoute("exec"), null);
  assert.deepEqual(nav.next(), { kind: "stop", id: "d" });
  assert.deepEqual(nav.stations(), ["b", "d"]);
  nav.useRoute(null);
  assert.deepEqual(nav.next(), { kind: "map", final: true });
});

test("excursions include the detour's own children, with pull-backs", () => {
  const map = world();
  assert.deepEqual(excursionRoute(map.byId.get("c")!), [{ kind: "stop", id: "c" }, { kind: "stop", id: "c1" }]);
});

test("tour: arrives at every target in order, holding longer on the ends", () => {
  const map = world(), c = ctx(map);
  const tour = buildTour(DEFAULT, c);
  assert.equal(tour.arrivals.length, DEFAULT.length);
  for (let i = 1; i < tour.arrivals.length; i++) assert.ok(tour.arrivals[i].t > tour.arrivals[i - 1].t);
  assert.ok(tour.duration > tour.arrivals[tour.arrivals.length - 1].t + 4);
  // Every trail on the route is walked by the end.
  const { lit } = tour.tl.litAt(tour.duration);
  for (const id of ["a", "a1", "a2", "a2x", "b", "b1", "d"]) assert.equal(lit.get(id)?.f, 1, id);
  assert.equal(lit.get("c"), undefined);
});
