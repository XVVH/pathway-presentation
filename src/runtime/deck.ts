// The audience page: the map, the camera and everything you can do to it.
// It is the source of truth for where the talk is; the presenter window only
// follows it and sends it commands.

import type { Payload, Target } from "../payload.ts";
import { Cards } from "./cards.ts";
import { camForTarget, clampWidth, fitNode, HUD_INSETS, viewport, type Viewport } from "./camera.ts";
import { byId, esc, fmtTime, readTokens, store, type Tokens } from "./dom.ts";
import { Ground, Minimap } from "./ground.ts";
import { buildHud, crumbsFor, hudRefs, positionLine, type Hud } from "./hud.ts";
import { createMap, layoutMap, targetNode, type MapNode, type TrailStep, type WorldMap } from "./map.ts";
import { hash, type Cam } from "./math.ts";
import { Navigator } from "./navigator.ts";
import { Strip } from "./strip.ts";
import { newToken, readMessage, targetOrigin, type Command, type DeckState } from "./sync.ts";
import { buildTerrain } from "./terrain.ts";
import { Timeline, flyTo, type MotionContext, type Profile } from "./timeline.ts";
import { buildTour, type Tour } from "./tour.ts";

declare global {
  interface Window { pathway?: CaptureApi }
}

/** What a headless browser drives to render stills and video. */
export interface CaptureApi {
  ready: Promise<void>;
  readonly duration: number;
  readonly stops: { t: number; kind: string; id?: string }[];
  /** Renders the tour at time t, with embedded video seeked to match. */
  seek(t: number): Promise<void>;
  /** Renders one target at rest: "map" or a stop id. */
  show(target: string): Promise<boolean>;
  /** Natural height of each card at the reference width, as a share of its width. */
  measure(): { id: string; title: string; ratio: number }[];
  /** Cards whose content is taller than the size the build gave them. */
  overflowing(): string[];
}

const now = () => performance.now() / 1000;

export function startDeck(payload: Payload, params: URLSearchParams): void {
  const docEl = document.documentElement;
  const capture = params.has("capture");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") docEl.dataset.theme = theme;
  if (capture) docEl.classList.add("capture");

  const map: WorldMap = createMap(payload.stops);
  layoutMap(map, payload.bend);
  const routes = new Map<string | null, Target[]>([[null, payload.route], ...payload.routes.map(r => [r.name, r.targets] as [string, Target[]])]);
  const nav = new Navigator(map, routes);
  const wantRoute = params.get("route");
  if (wantRoute && routes.has(wantRoute)) nav.useRoute(wantRoute);

  document.body.insertAdjacentHTML("afterbegin", buildHud(payload.title));
  document.body.insertAdjacentHTML("beforeend", '<div id="blank" aria-hidden="true"></div>');
  const hud: Hud = hudRefs();
  const stage = byId("stage"), worldEl = byId("world");
  const ground = new Ground(byId<HTMLCanvasElement>("ground"), map, buildTerrain(map, hash(payload.title || "pathway")));
  const cards = new Cards(worldEl, map);
  const minimap = new Minimap(hud.minimap, map);

  let tokens: Tokens = readTokens();
  let vp: Viewport = viewport(1280, 720), dpr = 1;
  let profile: Profile = params.get("motion") === "remote" ? "remote" : "cinematic";
  let mode: "live" | "tour" | "capture" = capture ? "capture" : "live";
  let tour: (Tour & { playing: boolean; t: number; origin: number }) | null = null;
  let dirty = true, introHint = true, assetsReady = false;
  let notice = "", noticeTimer = 0;
  let stripMode = false, mapOpen = false, hoverOn = true, hoverNode: MapNode | null = null, blank = false;
  const motion = (): MotionContext => ({ map, viewport: vp, profile: reducedMotion ? "reduced" : profile, flight: tokens.flight });

  function measure(): void {
    if (!stage.clientWidth) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vp = viewport(stage.clientWidth, stage.clientHeight, capture ? { top: 24, bottom: 24 } : HUD_INSETS);
    worldEl.style.setProperty("--cw", `${vp.cw}px`);
    ground.resize(vp.vw, vp.vh, dpr);
  }
  measure();

  // ------------------------------------------------------------ where we start
  const posKey = `pathway:pos:${hash(payload.title)}`;
  let live = new Timeline(camForTarget(vp, map, nav.current()), nav.current());
  const restored = !capture && restorePosition();
  const deepLink = !capture && !restored && location.hash.length > 1 ? map.byId.get(decodeURIComponent(location.hash.slice(1))) : undefined;
  if (deepLink) {
    // A link to a stop starts the talk there when the route passes it.
    if (!nav.continueFrom({ kind: "stop", id: deepLink.id })) nav.visit(deepLink.id);
    live = new Timeline(camForTarget(vp, map, nav.current()), nav.current());
  }

  function restorePosition(): boolean {
    try {
      const saved = JSON.parse(store.get(posKey) ?? "null") as { route: string | null; ri: number; here: Target; offRoute: boolean; walked: string[] } | null;
      if (!saved || !routes.has(saved.route)) return false;
      if (saved.here.kind !== "map" && !map.byId.has(saved.here.id)) return false;
      nav.useRoute(saved.route);
      nav.ri = Math.min(Math.max(0, saved.ri), nav.route.length - 1);
      nav.offRoute = saved.offRoute;
      nav.here = saved.here;
      const walked: TrailStep[] = saved.walked.flatMap(id => { const e = map.byId.get(id)?.edge; return e ? [{ id, len: e.len, rev: false }] : []; });
      live = new Timeline(camForTarget(vp, map, nav.current()), nav.current(), walked);
      return true;
    } catch { return false; }
  }
  function savePosition(): void {
    if (capture) return;
    const walked = live.walkedAt(now() + 60, map).map(s => s.id);
    store.set(posKey, JSON.stringify({ route: nav.routeName, ri: nav.ri, here: nav.current(), offRoute: nav.offRoute || !!nav.excursion, walked }));
  }

  // ------------------------------------------------------------ moving
  /**
   * Makes a move and lights what it walks: the route's own trail when it lands
   * on the route (from where your place was), a detour's as you walk it, and
   * nothing for a look (a click, ↑, the map), which leaves the trail as the talk drew it.
   */
  function move(f: () => Target | null): boolean {
    const leftAt = nav.route[nav.ri];
    const target = f();
    if (!target) return false;
    fly(target, !nav.offRoute ? leftAt : nav.excursion ? undefined : null);
    return true;
  }
  function fly(target: Target, lightFrom: Target | null | undefined): void {
    flyTo(live, now(), target, motion(), { lightFrom });
    hoverNode = null;
    dirty = true;
    updateHud();
    savePosition();
    link.send();
  }
  const presenting = () => mode === "live" && !stripMode;
  const act = (f: () => Target | null) => () => { if (!presenting()) return; introHint = false; move(f); };
  const next = act(() => nav.next()), prev = act(() => nav.prev()), dive = act(() => nav.dive()), surface = act(() => nav.surface());
  // Carrying on from a stop makes it part of the talk, but walks nothing: you're already there.
  function continueHere(): void {
    if (!presenting()) return;
    const t = nav.continueHere();
    if (t) fly(t, t);
  }
  function showMap(): void {
    if (mode !== "live") return;
    if (stripMode) { closeMap(null); return; }
    move(() => nav.showMap());
  }
  function visit(n: MapNode): void {
    if (mode !== "live") return;
    if (stripMode) { closeMap(n); return; }
    introHint = false;
    move(() => nav.visit(n.id));
  }
  function manualCam(cam: Cam): void {
    if (mode !== "live") return;
    const t = now(), last = live.last();
    nav.manual(); introHint = false;
    if (last.kind === "manual") { last.t0 = t; last.to = cam; last.from = cam; }
    else live.segs.push({ t0: t, dur: 0, from: cam, to: cam, kind: "manual", target: last.target, edges: [], total: 0 });
    dirty = true;
    updateHud();
  }
  function camNow(): Cam {
    const { fade: _f, ...c } = mode === "live" || !tour ? live.camAt(now()) : tour.tl.camAt(tourTime());
    return c;
  }

  // ------------------------------------------------------------ tour
  function enterTour(): void {
    const tl = buildTour(nav.route, motion());
    tour = { ...tl, playing: true, t: 0, origin: now() };
    mode = "tour";
    docEl.classList.add("touring");
    hud.buttons.tour.lastElementChild!.textContent = "Exit tour";
    dirty = true;
    link.send();
  }
  function exitTour(): void {
    if (!tour) return;
    const { fade: _f, ...cam } = tour.tl.camAt(tour.t);
    mode = "live"; tour = null;
    docEl.classList.remove("touring");
    hud.buttons.tour.lastElementChild!.textContent = "Play tour";
    live.segs.push({ t0: now(), dur: 0, from: cam, to: cam, kind: "cut", target: { kind: "map" }, edges: [], total: 0 });
    move(() => nav.goTo(nav.ri));
  }
  function tourTime(): number {
    if (!tour) return 0;
    if (tour.playing) tour.t = Math.min(tour.duration, now() - tour.origin);
    return tour.t;
  }
  function togglePlay(): void {
    if (!tour) return;
    if (tour.playing) { tourTime(); tour.playing = false; }
    else { if (tour.t >= tour.duration) tour.t = 0; tour.origin = now() - tour.t; tour.playing = true; }
    dirty = true;
  }
  const toggleTour = () => { if (stripMode) return; if (mode === "tour") exitTour(); else if (mode === "live") enterTour(); };
  hud.scrub.addEventListener("input", () => {
    if (!tour) return;
    tour.playing = false;
    tour.t = (Number(hud.scrub.value) / 1000) * tour.duration;
    dirty = true;
  });

  // ------------------------------------------------------------ drawing
  function render(tl: Timeline, t: number) {
    if (assetsReady && vp.vw > 1) cards.measureLines(`${vp.cw}`);
    const cam = tl.camAt(t);
    const lit = tl.litAt(t);
    const [seg] = tl.segAt(t);
    const settled = t >= seg.t0 + seg.dur;
    const remote = profile === "remote";
    docEl.classList.toggle("remote", remote);
    const from = targetNode(map, nav.current());
    ground.draw({ cam, vw: vp.vw, vh: vp.vh, dpr, lit, tokens, plain: remote, hover: hoverNode && mode === "live" && hoverOn ? { from, to: hoverNode } : null });
    const focus = seg.target.kind === "stop" ? seg.target.id : null;
    cards.update({ cam, vw: vp.vw, vh: vp.vh, cw: vp.cw, focus, settled, playing: mode === "live" || !!tour?.playing });
    if (!stripMode && !capture) minimap.draw(184, 104, dpr, tokens, lit.lit, { cam, aspect: vp.vh / vp.vw });
    return { seg, settled, focus };
  }

  function updateHud(): void {
    const target = mode === "tour" && tour ? tour.tl.segAt(tour.t)[0].target : nav.current();
    hud.crumbs.innerHTML = crumbsFor(map, target);
    if (mode !== "live" || stripMode) return;
    const ds = nav.detours();
    const hint = notice ? `<div class="hint">${esc(notice)}</div>` : introHint ? '<div class="hint">Press → to travel, ? for the legend.</div>' : "";
    const carry = nav.canContinueHere() ? '<div class="hint">C carries on the talk from here.</div>' : "";
    hud.status.innerHTML = `<div>${positionLine(nav)}</div>${ds.length ? `<div class="detour-hint">↓ Detour: ${esc(ds[0].stop.title)}</div>` : ""}${carry}${hint}`;
  }

  let lastHudTarget: Target | null = null;
  let lastSettled = true;
  function frame(): void {
    if (!(stripMode && !mapOpen)) {
      if (mode === "live") {
        const t = now(), last = live.last();
        const moving = t < last.t0 + last.dur + 0.05;
        if (dirty || moving) { render(live, t); dirty = false; }
        // Tell the presenter once the camera has arrived, so its minimap box is right.
        if (lastSettled !== !moving) { lastSettled = !moving; if (!moving) link.send(); }
      } else if (mode === "tour" && tour) {
        const t = tourTime();
        if (dirty || tour.playing) {
          render(tour.tl, t);
          dirty = false;
          hud.scrub.value = String(Math.round((t / tour.duration) * 1000));
          hud.scrubTime.textContent = `${fmtTime(t)} / ${fmtTime(tour.duration)}`;
          hud.play.textContent = tour.playing ? "❚❚" : "▶";
          const tgt = tour.tl.segAt(t)[0].target;
          if (tgt !== lastHudTarget) { lastHudTarget = tgt; updateHud(); }
          if (t >= tour.duration && tour.playing) { tour.playing = false; dirty = true; }
        }
      }
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ strip map (small screens)
  const strip = new Strip(byId("strip"), map, n => openMap(n), reducedMotion);
  function openMap(n: MapNode | null): void {
    mapOpen = true;
    docEl.classList.add("map-open");
    measure();
    tokens = readTokens();
    // Light the trail up to where the reader is, then pull back to show the branch.
    const order = payload.route.flatMap(s => (s.kind === "stop" ? [map.byId.get(s.id)!] : []));
    const upto = n ? order.indexOf(n.detour ? n.trailParent ?? n : n) : order.length - 1;
    const walked = order.slice(0, upto + 1).flatMap(x => (x.edge ? [{ id: x.id, len: x.edge.len, rev: false }] : []));
    const start: Target = n ? { kind: "stop", id: n.id } : { kind: "map" };
    live = new Timeline(n ? fitNode(vp, n) : camForTarget(vp, map, start), start, walked);
    live.segs[0].t0 = now() - 1;
    nav.manual();
    nav.here = start;
    if (n) {
      let a = n;
      while (a.parent && a.parent !== map.root) a = a.parent;
      const tgt: Target = a !== map.root && a.seq.length ? { kind: "lookback", id: a.id } : { kind: "map" };
      nav.here = tgt;
      flyTo(live, now(), tgt, motion(), { lightFrom: null });
    }
    dirty = true;
    updateHud();
  }
  function closeMap(scrollTo: MapNode | null): void {
    mapOpen = false;
    docEl.classList.remove("map-open");
    if (scrollTo) strip.scrollTo(scrollTo);
  }
  function wantStrip(): boolean {
    if (capture) return false;
    const v = params.get("view");
    if (v === "strip") return true;
    if (v === "map") return false;
    return window.innerWidth < 760 || window.innerHeight < 500;
  }
  function applyMode(): void {
    const want = wantStrip();
    if (want === stripMode) return;
    stripMode = want;
    docEl.classList.toggle("strip", stripMode);
    mapOpen = false;
    docEl.classList.remove("map-open");
    if (stripMode) {
      if (mode === "tour") exitTour();
      hideHelp();
      strip.build();
      requestAnimationFrame(() => { strip.drawRails(); strip.onScroll(); });
    } else {
      measure();
      live = new Timeline(camForTarget(vp, map, nav.current()), nav.current(), live.walkedAt(now(), map));
      dirty = true;
      updateHud();
    }
  }

  // ------------------------------------------------------------ presenter link
  const link = (() => {
    const tokenKey = `pathway:token:${hash(payload.title)}`;
    let token = store.get(tokenKey);
    let win: Window | null = null;
    const post = (msg: object) => { try { win?.postMessage({ pathway: 1, token, ...msg }, targetOrigin()); } catch { win = null; } };
    window.addEventListener("message", e => {
      const m = readMessage(e.data, token);
      if (!m || !e.source) return;
      if (m.type === "hello") { win = e.source as Window; send(); return; }
      if (m.type === "cmd" && e.source === win) command(m.command);
    });
    function state(): DeckState {
      const { fade: _f, ...cam } = live.camAt(now() + 60);
      return {
        route: nav.routeName, ri: nav.ri, target: nav.current(), offRoute: nav.offRoute,
        excursion: nav.excursion ? { i: nav.excursion.i, n: nav.excursion.stops.length, detour: nav.excursion.detour } : null,
        ahead: nav.ahead() ?? null, detours: nav.detours().map(d => d.id), walked: live.walkedAt(now() + 60, map).map(s => s.id),
        cam, aspect: vp.vh / vp.vw, blank, touring: mode === "tour",
      };
    }
    function send(): void { if (win && !win.closed) post({ type: "state", state: state() }); }
    function open(): void {
      if (!token) { token = newToken(); store.set(tokenKey, token); }
      const url = `${location.href.split(/[?#]/)[0]}?presenter=${token}`;
      const w = window.open(url, `pathway-presenter-${hash(payload.title)}`, "popup,width=1180,height=760");
      if (w) win = w;
      else flash(framed()
        ? "The presenter window can't open while this deck is shown inside another page. Open the deck in its own browser tab."
        : "The presenter window was blocked. Allow pop-ups for this page, then press P again.");
    }
    return { send, open };
  })();
  /** Inside another page's frame (an embed, an app's viewer), which can stop windows opening or talking. */
  function framed(): boolean {
    try { return window.self !== window.top; } catch { return true; }
  }
  function command(c: Command): void {
    if (blank && c.cmd !== "blank") setBlank(false);
    switch (c.cmd) {
      case "next": next(); break;
      case "prev": prev(); break;
      case "dive": dive(); break;
      case "surface": surface(); break;
      case "map": showMap(); break;
      case "blank": setBlank(!blank); break;
      case "continue": continueHere(); break;
      case "detour": if (presenting()) move(() => nav.takeDetour(c.id)); break;
      case "visit": { const n = map.byId.get(c.id); if (n) visit(n); break; }
      case "route": if (presenting() && !move(() => nav.useRoute(c.name))) { updateHud(); savePosition(); link.send(); } break;
    }
  }
  /** A short message in the status line, for things the presenter should know now. */
  function flash(message: string): void {
    notice = message;
    updateHud();
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { notice = ""; updateHud(); }, 6000);
  }
  function setBlank(on: boolean): void {
    blank = on;
    docEl.classList.toggle("blank", on);
    link.send();
  }

  // ------------------------------------------------------------ input
  function toggleHelp(): void { hud.help.hidden = !hud.help.hidden; }
  function hideHelp(): void {
    if (hud.help.hidden) return;
    hud.help.hidden = true;
    hud.start.textContent = "Close";
  }
  hud.start.onclick = () => {
    const first = hud.start.textContent !== "Close";
    hideHelp();
    stage.focus({ preventScroll: true });
    if (first && nav.ri === 0 && !nav.offRoute) next();
  };
  function toggleMotion(): void {
    profile = profile === "remote" ? "cinematic" : "remote";
    hud.buttons.motion.setAttribute("aria-pressed", String(profile === "remote"));
    dirty = true;
  }
  function toggleTheme(): void {
    const dark = docEl.dataset.theme ? docEl.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    docEl.dataset.theme = dark ? "light" : "dark";
  }
  function toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else docEl.requestFullscreen?.().catch(() => undefined);
  }
  const keyMap: Record<string, () => void> = {
    ArrowRight: next, " ": next, PageDown: next, Enter: next, ArrowLeft: prev, PageUp: prev, Backspace: prev,
    ArrowDown: dive, ArrowUp: surface, m: showMap, M: showMap, Escape: () => (mode === "tour" ? exitTour() : showMap()),
    Home: () => { if (presenting()) move(() => nav.goTo(0)); }, End: () => { if (presenting()) move(() => nav.goTo(nav.route.length - 1)); },
    r: toggleMotion, R: toggleMotion, v: toggleTour, V: toggleTour, p: () => link.open(), P: () => link.open(),
    h: () => { hoverOn = !hoverOn; hoverNode = null; dirty = true; }, H: () => { hoverOn = !hoverOn; hoverNode = null; dirty = true; },
    b: () => setBlank(!blank), B: () => setBlank(!blank), ".": () => setBlank(!blank),
    d: toggleTheme, D: toggleTheme, f: toggleFullscreen, F: toggleFullscreen, "?": toggleHelp,
    c: continueHere, C: continueHere,
  };
  window.addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey || mode === "capture") return;
    if ((e.target as HTMLElement).closest?.("input, select, textarea")) return;
    if (blank) { e.preventDefault(); if (!["b", "B", "."].includes(e.key)) { setBlank(false); return; } }
    if (stripMode && !mapOpen && !["?", "d", "D"].includes(e.key)) return; // let the strip scroll natively
    if (mode === "tour" && e.key === " ") { e.preventDefault(); togglePlay(); return; }
    if (e.key !== "?") hideHelp();
    if (!["h", "H"].includes(e.key)) hoverNode = null;
    const f = keyMap[e.key];
    if (f) { e.preventDefault(); f(); }
  });
  hud.buttons.next.onclick = () => next();
  hud.buttons.prev.onclick = () => prev();
  hud.buttons.map.onclick = () => showMap();
  hud.buttons.back.onclick = () => closeMap(null);
  hud.buttons.motion.onclick = toggleMotion;
  hud.buttons.tour.onclick = toggleTour;
  hud.buttons.presenter.onclick = () => link.open();
  hud.buttons.help.onclick = toggleHelp;
  hud.play.onclick = togglePlay;
  byId("blank").onclick = () => setBlank(false);

  // Links between stops.
  worldEl.addEventListener("click", e => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.stop-link");
    if (!a?.dataset.stop) return;
    e.preventDefault();
    const n = map.byId.get(a.dataset.stop);
    if (n) visit(n);
  });
  byId("strip").addEventListener("click", e => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.stop-link");
    if (!a?.dataset.stop) return;
    e.preventDefault();
    const n = map.byId.get(a.dataset.stop);
    if (n) strip.scrollTo(n);
  });
  window.addEventListener("hashchange", () => {
    const n = map.byId.get(decodeURIComponent(location.hash.slice(1)));
    if (n) visit(n);
  });

  // Pointer: drag to pan, pinch or wheel to zoom, click a stop to go there.
  // Hovering a stop lights the trail from here to it: an invitation, not a preview.
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { cam: Cam; start: { x: number; y: number }[]; moved: boolean } | null = null;
  const onHud = (e: Event) => !!(e.target as HTMLElement).closest("#hud button, #hud input, #minimap, #help, #dev, a");
  stage.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse" || mode !== "live" || drag) return;
    const n = !hoverOn || onHud(e) ? null : hitTest(e.clientX, e.clientY);
    if (n !== hoverNode) { hoverNode = n; dirty = true; stage.style.cursor = n ? "zoom-in" : ""; }
  });
  stage.addEventListener("pointerleave", () => { if (hoverNode) { hoverNode = null; dirty = true; } });
  stage.addEventListener("pointerdown", e => {
    if (onHud(e)) return;
    hideHelp();
    if (mode !== "live") return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { cam: camNow(), start: [...pointers.values()].map(p => ({ ...p })), moved: false };
    stage.focus({ preventScroll: true });
  });
  stage.addEventListener("pointermove", e => {
    if (!drag || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()], k0 = vp.vw / drag.cam.w;
    if (pts.length === 1 && drag.start.length === 1) {
      const dx = pts[0].x - drag.start[0].x, dy = pts[0].y - drag.start[0].y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      stage.classList.add("dragging");
      hoverNode = null;
      manualCam({ x: drag.cam.x - dx / k0, y: drag.cam.y - dy / k0, w: drag.cam.w });
    } else if (pts.length === 2) {
      if (drag.start.length !== 2) { drag = { cam: camNow(), start: pts.map(p => ({ ...p })), moved: true }; return; }
      const d0 = Math.hypot(drag.start[0].x - drag.start[1].x, drag.start[0].y - drag.start[1].y);
      const d1 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const m0 = { x: (drag.start[0].x + drag.start[1].x) / 2, y: (drag.start[0].y + drag.start[1].y) / 2 };
      const m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const w = clampWidth(vp, map, (drag.cam.w * d0) / Math.max(d1, 1)), k1 = vp.vw / w;
      const rect = stage.getBoundingClientRect();
      const wx = drag.cam.x + (m0.x - rect.left - vp.vw / 2) / k0, wy = drag.cam.y + (m0.y - rect.top - vp.vh / 2) / k0;
      manualCam({ x: wx - (m1.x - rect.left - vp.vw / 2) / k1, y: wy - (m1.y - rect.top - vp.vh / 2) / k1, w });
    }
  });
  function endPointer(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (drag && !drag.moved && pointers.size === 0) { const hit = hitTest(e.clientX, e.clientY); if (hit) visit(hit); }
    if (pointers.size === 0) { drag = null; stage.classList.remove("dragging"); if (nav.offRoute) { savePosition(); link.send(); } }
  }
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  function hitTest(px: number, py: number): MapNode | null {
    const rect = stage.getBoundingClientRect(), cam = camNow(), k = vp.vw / cam.w;
    const x = cam.x + (px - rect.left - vp.vw / 2) / k, y = cam.y + (py - rect.top - vp.vh / 2) / k;
    let best: MapNode | null = null;
    for (const n of map.nodes) if (Math.abs(x - n.x) < n.ww / 2 && Math.abs(y - n.y) < n.wh / 2 && (!best || n.ww < best.ww)) best = n;
    return best;
  }
  stage.addEventListener("wheel", e => {
    if (mode !== "live" || (e.target as HTMLElement).closest("#help, #dev")) return;
    e.preventDefault();
    const cam = camNow(), k0 = vp.vw / cam.w, rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left - vp.vw / 2, py = e.clientY - rect.top - vp.vh / 2;
    const wx = cam.x + px / k0, wy = cam.y + py / k0;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const w = clampWidth(vp, map, cam.w * Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0016))), k1 = vp.vw / w;
    manualCam({ x: wx - px / k1, y: wy - py / k1, w });
  }, { passive: false });
  hud.minimap.addEventListener("click", e => {
    if (mode !== "live") return;
    const r = hud.minimap.getBoundingClientRect();
    const n = minimap.pick(e.clientX - r.left, e.clientY - r.top);
    if (n) visit(n);
  });

  // ------------------------------------------------------------ environment
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { tokens = readTokens(); dirty = true; });
  new MutationObserver(() => { tokens = readTokens(); dirty = true; }).observe(docEl, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("resize", () => {
    applyMode();
    if (stripMode) { strip.drawRails(); strip.onScroll(); if (!mapOpen) return; }
    measure();
    if (mode === "live") {
      const tg = nav.current(), cam = camForTarget(vp, map, tg);
      live.segs.push({ t0: now(), dur: 0, from: cam, to: cam, kind: "cut", target: tg, edges: [], total: 0 });
    } else if (tour) {
      tour = { ...buildTour(nav.route, motion()), playing: tour.playing, t: tour.t, origin: tour.origin };
    }
    dirty = true;
    updateHud();
  });

  // ------------------------------------------------------------ dev (pathway present)
  function showDev(extra: string[] = []): void {
    const errors = (payload.problems ?? []).filter(p => p.severity === "error");
    const warnings = (payload.problems ?? []).length - errors.length;
    const items = [...errors.map(p => `Line ${p.line}: ${esc(p.message)}`), ...extra];
    if (!items.length) { hud.dev.hidden = true; return; }
    hud.dev.innerHTML = `<b>${errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : "Check"}</b>${warnings ? ` and ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}. Fix them in the deck; this page reloads.<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
    hud.dev.hidden = false;
  }
  if (payload.dev && !capture) {
    hud.dev.onclick = () => { hud.dev.hidden = true; };
    showDev();
    try {
      const es = new EventSource("/__pathway/events");
      es.addEventListener("reload", () => { savePosition(); location.reload(); });
    } catch { /* not served by pathway present */ }
  }

  // ------------------------------------------------------------ start
  tokens = readTokens();
  hud.buttons.motion.setAttribute("aria-pressed", String(profile === "remote"));
  const assets = cards.ready().then(() => {
    assetsReady = true;
    dirty = true;
    if (payload.dev) requestAnimationFrame(() => {
      const over = cards.overflowing().map(id => `“${esc(map.byId.get(id)!.stop.title)}” is taller than its card here. The size estimate is low; please report it.`);
      if (over.length) showDev(over);
    });
  });
  applyMode();
  if (restored || deepLink || capture || stripMode) { hud.help.hidden = true; hud.start.textContent = "Close"; introHint = false; }
  updateHud();

  if (!capture) {
    requestAnimationFrame(frame);
    if (!stripMode) stage.focus({ preventScroll: true });
    return;
  }

  // ------------------------------------------------------------ capture (headless)
  // Precompute the tour and let the recorder step the clock.
  let capTour: Tour | null = null;
  const videos = cards.states.filter(s => s.video);
  const ready = assets.then(async () => {
    measure();
    cards.measureLines(`${vp.cw}`);
    capTour = buildTour(nav.route, motion());
    await Promise.all(videos.map(s => new Promise<void>(res => {
      const v = s.video!;
      v.preload = "auto";
      v.src = v.dataset.src ?? "";
      v.dataset.loaded = "1";
      v.load();
      if (v.readyState >= 2) { res(); return; }
      // A video the browser can't decode shouldn't stall a render forever.
      const done = () => res();
      v.addEventListener("loadeddata", done, { once: true });
      v.addEventListener("error", done, { once: true });
      setTimeout(done, 10000);
    })));
  });
  window.pathway = {
    ready,
    get duration() { return capTour?.duration ?? 0; },
    get stops() { return (capTour?.arrivals ?? []).map(a => ({ t: Math.round(a.t * 100) / 100, kind: a.target.kind, id: a.target.kind === "map" ? undefined : a.target.id })); },
    async seek(t: number) {
      if (!capTour) return;
      const { seg, settled, focus } = render(capTour.tl, t);
      if (seg.target !== lastHudTarget) lastHudTarget = seg.target;
      const waits: Promise<unknown>[] = [];
      for (const s of videos) {
        const v = s.video!, d = v.duration || 1;
        const want = s.node.id === focus && settled ? (t - (seg.t0 + seg.dur)) % d : 0;
        if (Math.abs(v.currentTime - want) > 0.004) { waits.push(new Promise(r => v.addEventListener("seeked", r, { once: true }))); v.currentTime = want; }
      }
      await Promise.all(waits);
    },
    async show(id: string) {
      const target: Target | null = id === "map" ? { kind: "map", final: true } : map.byId.has(id) ? { kind: "stop", id } : null;
      if (!target) return false;
      const walked = id === "map" ? map.edges.filter(e => !e.detour).map(e => ({ id: e.id, len: e.len, rev: false })) : [];
      const tl = new Timeline(camForTarget(vp, map, target), target, walked);
      render(tl, 0);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    },
    measure() {
      const box = document.createElement("div");
      box.className = "measure";
      document.body.appendChild(box);
      const out = cards.states.map(s => {
        const clone = s.el.cloneNode(true) as HTMLElement;
        clone.removeAttribute("style");
        clone.querySelector(".bars")?.remove();
        clone.querySelectorAll<HTMLElement>("[style]").forEach(el => { el.style.opacity = ""; });
        box.appendChild(clone);
        const ratio = clone.offsetHeight / box.clientWidth;
        clone.remove();
        return { id: s.node.id, title: s.node.stop.title, ratio: Math.round(ratio * 10000) / 10000 };
      });
      box.remove();
      return out;
    },
    overflowing: () => cards.overflowing(),
  };
}
