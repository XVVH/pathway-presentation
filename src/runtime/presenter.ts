// The presenter window: the same page, opened from the deck with P. It shows
// your notes for where the talk is, what comes next, the detours within reach,
// a timer, and the map; its keys drive the deck. The deck stays the source of
// truth, so a clicker works whichever window has focus.

import type { Payload, Target } from "../payload.ts";
import { byId, esc, fmtTime, pad2, readTokens } from "./dom.ts";
import { Minimap } from "./ground.ts";
import { positionLine, targetLabel } from "./hud.ts";
import { createMap, layoutMap, type WorldMap } from "./map.ts";
import { Navigator, excursionRoute } from "./navigator.ts";
import { readMessage, targetOrigin, type Command, type DeckState } from "./sync.ts";

export function startPresenter(payload: Payload, token: string): void {
  const map: WorldMap = createMap(payload.stops);
  layoutMap(map, payload.bend);
  const routes = new Map<string | null, Target[]>([[null, payload.route], ...payload.routes.map(r => [r.name, r.targets] as [string, Target[]])]);
  const nav = new Navigator(map, routes);
  const opener = window.opener as Window | null;
  document.title = `Presenter · ${payload.title}`;
  document.body.classList.add("presenter");
  document.body.insertAdjacentHTML("afterbegin", `
<div id="presenter">
  <header>
    <div class="clock"><span id="p-timer">0:00</span><small id="p-wall"></small></div>
    <button id="p-timer-toggle" type="button">Start timer</button>
    <button id="p-timer-reset" type="button">Reset</button>
    <span class="spacer"></span>
    ${payload.routes.length ? `<label class="link">Route <select id="p-route"><option value="">Reading order</option>${payload.routes.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join("")}</select></label>` : ""}
    <span class="link" id="p-link">Waiting for the deck</span>
  </header>
  <section class="panel now" aria-live="polite">
    <div class="where" id="p-where"></div>
    <h1 id="p-title">${esc(payload.title)}</h1>
    <div class="notes md" id="p-notes"></div>
  </section>
  <aside>
    <div class="panel"><h2>Next</h2><div class="next-title" id="p-next"></div><div class="next-sub" id="p-next-sub"></div>
      <button type="button" data-cmd="continue" id="p-continue" class="carry" hidden title="Make this stop your place on the route (C)">Carry on from here instead (C)</button></div>
    <div class="panel"><h2>Detours from here</h2><div class="detours" id="p-detours"></div></div>
    <div class="panel"><h2>Drive the deck</h2><div class="keys">
      <button type="button" data-cmd="prev" aria-label="Previous">←</button>
      <button type="button" data-cmd="dive" aria-label="Detour">↓</button>
      <button type="button" data-cmd="surface" aria-label="Pull back">↑</button>
      <button type="button" data-cmd="map" aria-label="Whole map">⌖</button>
      <button type="button" data-cmd="next" aria-label="Next">→</button>
      <button type="button" data-cmd="blank" id="p-blank" aria-pressed="false">Blank</button>
    </div></div>
    <div class="panel"><canvas id="p-map" aria-label="Map. Click to send the deck there."></canvas></div>
  </aside>
</div>`);

  const els = {
    timer: byId("p-timer"), wall: byId("p-wall"), toggle: byId<HTMLButtonElement>("p-timer-toggle"), reset: byId<HTMLButtonElement>("p-timer-reset"),
    link: byId("p-link"), where: byId("p-where"), title: byId("p-title"), notes: byId("p-notes"),
    next: byId("p-next"), nextSub: byId("p-next-sub"), carry: byId<HTMLButtonElement>("p-continue"), detours: byId("p-detours"), blank: byId<HTMLButtonElement>("p-blank"),
    map: byId<HTMLCanvasElement>("p-map"), route: document.getElementById("p-route") as HTMLSelectElement | null,
  };
  const minimap = new Minimap(els.map, map);
  let tokens = readTokens();
  let state: DeckState | null = null, lastState = 0;

  const send = (command: Command) => { try { opener?.postMessage({ pathway: 1, token, type: "cmd", command }, targetOrigin()); } catch { /* deck closed */ } };
  window.addEventListener("message", e => {
    if (e.source !== opener) return;
    const m = readMessage(e.data, token);
    if (!m || m.type !== "state") return;
    lastState = Date.now();
    state = m.state;
    if (!timer.running && timer.elapsed === 0 && (state.ri > 1 || state.offRoute)) timer.start();
    render();
  });
  const hello = () => { try { opener?.postMessage({ pathway: 1, token, type: "hello" }, targetOrigin()); } catch { /* deck closed */ } };

  // ------------------------------------------------------------ timer
  const timer = {
    running: false, elapsed: 0, since: 0,
    now(): number { return this.elapsed + (this.running ? (Date.now() - this.since) / 1000 : 0); },
    start(): void { if (!this.running) { this.running = true; this.since = Date.now(); } },
    pause(): void { if (this.running) { this.elapsed = this.now(); this.running = false; } },
    reset(): void { this.running = false; this.elapsed = 0; },
  };
  els.toggle.onclick = () => { if (timer.running) timer.pause(); else timer.start(); tick(); };
  els.reset.onclick = () => { timer.reset(); tick(); };
  function tick(): void {
    els.timer.textContent = fmtTime(timer.now());
    els.toggle.textContent = timer.running ? "Pause" : timer.now() > 0 ? "Resume" : "Start timer";
    const d = new Date();
    els.wall.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const linked = !!opener && !opener.closed && Date.now() - lastState < 5000;
    els.link.textContent = !opener ? "Open this window from the deck: press P there" : linked ? "Linked to the deck" : "Waiting for the deck";
    els.link.classList.toggle("on", linked);
  }

  // ------------------------------------------------------------ view
  function render(): void {
    if (!state) return;
    nav.useRoute(state.route);
    nav.ri = Math.min(state.ri, nav.route.length - 1);
    nav.offRoute = state.offRoute;
    nav.here = state.target;
    const d = state.excursion ? map.byId.get(state.excursion.detour) : undefined;
    nav.excursion = d && state.excursion ? { stops: excursionRoute(d), i: state.excursion.i, detour: d.id } : null;
    if (els.route) els.route.value = state.route ?? "";

    const t = state.target, named = state.route !== null;
    const n = t.kind === "map" ? null : map.byId.get(t.id) ?? null;
    els.where.innerHTML = state.touring ? "Playing the tour" : positionLine(nav);
    if (t.kind === "map") els.title.textContent = t.final ? "Everywhere we went" : "The whole map";
    else if (t.kind === "lookback") els.title.textContent = `Looking back over ${n?.stop.title ?? ""}`;
    else els.title.textContent = n?.stop.title ?? "";
    const notes = payload.notes;
    if (!notes) els.notes.innerHTML = '<p class="none">Speaker notes aren\'t in this build. Build with --with-notes, or use pathway present.</p>';
    else if (t.kind === "stop") els.notes.innerHTML = notes[t.id] ?? '<p class="none">No notes for this stop.</p>';
    else els.notes.innerHTML = `<p class="none">${t.kind === "map" ? "The whole map." : "A pull-back to show the branch you've walked."} No notes here.</p>`;

    const x = nav.excursion;
    const upcoming: Target | null = x && x.i + 1 < x.stops.length ? x.stops[x.i + 1] : state.ahead;
    const un = upcoming && upcoming.kind !== "map" ? map.byId.get(upcoming.id) : null;
    els.next.textContent = !upcoming ? "The end" : upcoming.kind === "stop" ? un?.stop.title ?? "" : capitalise(targetLabel(map, upcoming, named));
    const rejoin = state.offRoute && !x ? "rejoins the route" : "";
    els.nextSub.textContent = upcoming?.kind === "stop" && un
      ? [!named && un.stop.number !== null && `Stop ${pad2(un.stop.number)}`, un.detour && "Detour", un.parent && un.parent !== map.root && `in ${un.parent.stop.title}`, rejoin].filter(Boolean).join(" · ")
      : capitalise(rejoin);
    els.carry.hidden = state.touring || !nav.canContinueHere();
    els.detours.innerHTML = state.detours.length
      ? state.detours.map(id => `<button type="button" data-detour="${esc(id)}">↓ ${esc(map.byId.get(id)?.stop.title ?? id)}</button>`).join("")
      : '<span class="none">None from here.</span>';
    els.blank.setAttribute("aria-pressed", String(state.blank));
    drawMap();
  }
  function drawMap(): void {
    const r = els.map.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const lit = new Map((state?.walked ?? []).map(id => [id, { f: 1, rev: false }]));
    const here = state && state.target.kind !== "map" ? state.target.id : null;
    minimap.draw(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2), tokens, lit, state ? { cam: state.cam, aspect: state.aspect } : null, here);
  }

  // ------------------------------------------------------------ input
  document.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-cmd], button[data-detour], a.stop-link");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.detour) send({ cmd: "detour", id: b.dataset.detour });
    else if (b.dataset.stop) send({ cmd: "visit", id: b.dataset.stop });
    else send({ cmd: b.dataset.cmd as "next" });
  });
  els.route?.addEventListener("change", () => send({ cmd: "route", name: els.route!.value || null }));
  els.map.addEventListener("click", e => {
    const r = els.map.getBoundingClientRect();
    const n = minimap.pick(e.clientX - r.left, e.clientY - r.top);
    if (n) send({ cmd: "visit", id: n.id });
  });
  const keys: Record<string, Command["cmd"]> = {
    ArrowRight: "next", " ": "next", PageDown: "next", Enter: "next", ArrowLeft: "prev", PageUp: "prev", Backspace: "prev",
    ArrowDown: "dive", ArrowUp: "surface", m: "map", M: "map", Escape: "map", b: "blank", B: "blank", ".": "blank",
    c: "continue", C: "continue",
  };
  window.addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("select, input")) return;
    const cmd = keys[e.key];
    if (!cmd) return;
    e.preventDefault();
    send({ cmd } as Command);
  });
  window.addEventListener("resize", drawMap);
  new MutationObserver(() => { tokens = readTokens(); drawMap(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  hello();
  setInterval(hello, 2000);
  setInterval(tick, 500);
  tick();
  els.notes.innerHTML = '<p class="none">Waiting for the deck. Keep its window open; this one follows it.</p>';
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
