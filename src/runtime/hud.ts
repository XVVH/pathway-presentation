// The heads-up display: where you are (crumbs), what's next (status), the
// controls, the minimap, the tour scrubber, and the legend.

import type { Target } from "../payload.ts";
import { byId, esc, pad2 } from "./dom.ts";
import type { MapNode, WorldMap } from "./map.ts";
import type { Navigator } from "./navigator.ts";

export const KEYS: [string, string][] = [
  ["→ / space", "Next stop. Off the route, it rejoins where you left."],
  ["←", "Previous stop, or back to where you left the route."],
  ["↓", "Take the detour offered here."],
  ["↑", "Pull back to see the branch you're on."],
  ["M / Esc", "The whole map."],
  ["P", "Presenter window: notes, timer, what's next."],
  ["V", "Play the route by itself, with a scrubber."],
  ["R", "Remote mode: quicker, flatter moves for screen share."],
  ["B", "Blank the screen. Any key brings it back."],
  ["D", "Dark or light."],
  ["F", "Full screen."],
  ["Drag, wheel, pinch", "Explore freely. Click any stop to go there."],
];

export interface Hud {
  crumbs: HTMLElement;
  status: HTMLElement;
  minimap: HTMLCanvasElement;
  help: HTMLElement;
  start: HTMLButtonElement;
  scrub: HTMLInputElement;
  scrubTime: HTMLElement;
  play: HTMLButtonElement;
  dev: HTMLElement;
  buttons: Record<"tour" | "motion" | "presenter" | "help" | "prev" | "next" | "map" | "back", HTMLButtonElement>;
}

export function buildHud(title: string): string {
  return `
<main id="stage" tabindex="0" aria-label="${esc(title)}: a map of the talk. Use the arrow keys to travel.">
  <canvas id="ground"></canvas>
  <div id="world"></div>
  <div id="hud">
    <div class="hud-row">
      <div id="crumbs" class="pill" aria-live="polite"></div>
      <div class="chips">
        <button id="btn-tour" type="button" title="Play the route by itself (V)"><span class="k">V</span><span>Play tour</span></button>
        <button id="btn-motion" type="button" title="Motion for screen share (R)" aria-pressed="false"><span class="k">R</span><span>Remote</span></button>
        <button id="btn-presenter" type="button" title="Presenter window (P)"><span class="k">P</span><span>Presenter</span></button>
        <button id="btn-help" type="button" title="Keys (?)" aria-label="Keys">?</button>
      </div>
    </div>
    <div class="hud-bottom">
      <canvas id="minimap" class="pill" aria-label="Minimap. Click to go there."></canvas>
      <div>
        <div id="status" class="pill"></div>
        <div id="scrub" class="pill">
          <button id="btn-play" type="button" aria-label="Play or pause">❚❚</button>
          <input id="scrub-range" type="range" min="0" max="1000" value="0" aria-label="Tour position">
          <span id="scrub-time">0:00 / 0:00</span>
        </div>
        <button id="btn-back" type="button">← Back to the strip</button>
      </div>
      <div class="nav">
        <button id="btn-prev" type="button" aria-label="Previous stop">←</button>
        <button id="btn-map" type="button" aria-label="Whole map">⌖</button>
        <button id="btn-next" type="button" aria-label="Next stop">→</button>
      </div>
    </div>
    <div id="help" class="pill" role="dialog" aria-label="Keys">
      <h3>Legend</h3>
      <p class="deck-title">${esc(title)}</p>
      <dl>${KEYS.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <p>Press ? to bring this back. On a narrow screen the route becomes a scrolling strip.</p>
      <div class="help-actions"><button id="btn-start" type="button">Start →</button></div>
    </div>
  </div>
  <div id="dev" class="pill" hidden></div>
</main>
<div id="strip" aria-label="The route as a scrolling strip"></div>`;
}

export function hudRefs(): Hud {
  return {
    crumbs: byId("crumbs"), status: byId("status"), minimap: byId<HTMLCanvasElement>("minimap"), help: byId("help"),
    start: byId<HTMLButtonElement>("btn-start"), scrub: byId<HTMLInputElement>("scrub-range"), scrubTime: byId("scrub-time"),
    play: byId<HTMLButtonElement>("btn-play"), dev: byId("dev"),
    buttons: {
      tour: byId<HTMLButtonElement>("btn-tour"), motion: byId<HTMLButtonElement>("btn-motion"), presenter: byId<HTMLButtonElement>("btn-presenter"),
      help: byId<HTMLButtonElement>("btn-help"), prev: byId<HTMLButtonElement>("btn-prev"), next: byId<HTMLButtonElement>("btn-next"),
      map: byId<HTMLButtonElement>("btn-map"), back: byId<HTMLButtonElement>("btn-back"),
    },
  };
}

export function crumbsHtml(n: MapNode): string {
  const path: MapNode[] = [];
  for (let c: MapNode | null = n; c; c = c.parent) path.unshift(c);
  return path.map((p, i) => (i === path.length - 1 ? `<b>${esc(p.stop.title)}</b>` : esc(p.stop.title))).join('<span class="sep">/</span>');
}

export function crumbsFor(map: WorldMap, t: Target): string {
  if (t.kind === "map") return `<b>${esc(map.root.stop.title)}</b><span class="sep">/</span>${t.final ? "Everywhere we went" : "The whole map"}`;
  return crumbsHtml(map.byId.get(t.id) ?? map.root);
}

/** How a target reads in a sentence: "rejoins at stop 04". */
export function targetLabel(map: WorldMap, t: Target | undefined | null, named: boolean): string {
  if (!t) return "the end";
  if (t.kind === "map") return t.final ? "the whole trail" : "the territory";
  const n = map.byId.get(t.id);
  if (!n) return "the trail";
  if (t.kind === "lookback") return `a look back over ${n.stop.title}`;
  if (n === map.root) return "the trailhead";
  return !named && n.stop.number !== null ? `stop ${pad2(n.stop.number)}` : n.stop.title;
}

/** "Stop 04 / 12", "Detour 1 of 2 · → returns to stop 05", and so on. */
export function positionLine(nav: Navigator): string {
  const map = nav.map, named = nav.routeName !== null;
  const ahead = targetLabel(map, nav.ahead(), named), sep = '<span class="sep">·</span>';
  if (nav.excursion) return `Detour ${nav.excursion.i + 1} of ${nav.excursion.stops.length} ${sep} → returns to ${esc(ahead)}`;
  if (nav.offRoute) return `Off route ${sep} → rejoins at ${esc(ahead)}`;
  const at = nav.route[nav.ri];
  const prefix = named ? `${esc(nav.routeName!)} ${sep} ` : "";
  if (at.kind === "stop" && at.id !== map.root.id) {
    const stations = nav.stations(), i = stations.indexOf(at.id) + 1;
    return `${prefix}<span class="now">Stop ${pad2(i)}</span> / ${pad2(stations.length)}`;
  }
  return `${prefix}<span class="now">${esc(targetLabel(map, at, named))}</span>`;
}
