// Strip map: on a small screen the same route unrolls into one column, the way
// old road atlases unrolled a journey into a strip. Scrolling is walking: the
// rail lights up to the reading line, detours fold away, and the landscape is
// one tap away.

import { crumbsHtml } from "./hud.ts";
import { esc, byId } from "./dom.ts";
import { loadVideo, stopHtml } from "./cards.ts";
import type { MapNode, WorldMap } from "./map.ts";

export class Strip {
  readonly el: HTMLElement;
  readonly map: WorldMap;
  /** The stop at the reading line. */
  current: MapNode | null = null;
  private built = false;
  private pos = new Map<MapNode, { x: number; y: number; el?: SVGCircleElement }>();
  private raf = 0;
  private onOpenMap: (n: MapNode | null) => void;
  private reducedMotion: boolean;

  constructor(el: HTMLElement, map: WorldMap, onOpenMap: (n: MapNode | null) => void, reducedMotion: boolean) {
    this.el = el;
    this.map = map;
    this.onOpenMap = onOpenMap;
    this.reducedMotion = reducedMotion;
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    const { map } = this;
    const card = (c: MapNode) => `<section class="s-stop s-card lvl-${c.level}${c.detour ? " detour" : ""}" id="s-${esc(c.id)}" data-id="${esc(c.id)}" style="--depth:${c.level - 2}">${stopHtml(c, map, "h2")}</section>`;
    const parts: string[] = [];
    (function walk(n: MapNode) {
      for (const c of n.seq) {
        if (c.detour) {
          const inner: string[] = [];
          (function sub(d: MapNode) { inner.push(card(d)); for (const k of d.seq) sub(k); })(c);
          parts.push(`<details class="s-detour" data-id="${esc(c.id)}" style="--depth:${c.level - 2}"><summary class="s-card"><span class="tag">Detour</span><span>${esc(c.stop.title)}</span></summary>${inner.join("")}</details>`);
        } else { parts.push(card(c)); walk(c); }
      }
    })(map.root);
    const stations = map.nodes.filter(n => n.stop.number !== null).length;
    this.el.innerHTML = `
      <div class="s-bar"><div class="s-crumb" id="s-crumb"></div><button type="button" id="s-map">Map</button></div>
      <div class="s-col">
        <header class="s-hero"><div class="eyebrow"><span class="num">${stations} stops</span><span>Scroll to walk the route</span></div><h1>${esc(map.root.stop.title)}</h1><div class="md">${map.root.stop.body}</div></header>
        <div class="s-trail" id="s-trail"><svg class="s-rail" id="s-rail" aria-hidden="true"></svg>${parts.join("")}</div>
        <footer class="s-end"><p>End of the route</p><button type="button" id="s-whole">See the whole map</button></footer>
      </div>`;
    byId("s-map").onclick = () => this.onOpenMap(this.current ?? map.root);
    byId("s-whole").onclick = () => this.onOpenMap(null);
    this.el.addEventListener("scroll", () => {
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.onScroll(); });
    }, { passive: true });
    this.el.querySelectorAll("details").forEach(d => d.addEventListener("toggle", () => { this.drawRails(); this.onScroll(); }));
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting) { loadVideo(v); v.play().catch(() => undefined); } else v.pause();
      }
    }, { root: this.el, threshold: 0.6 });
    this.el.querySelectorAll("video").forEach(v => io.observe(v));
  }

  drawRails(): void {
    const trail = document.getElementById("s-trail"), svg = document.getElementById("s-rail");
    if (!trail || !svg) return;
    const top = trail.getBoundingClientRect().top, H = trail.scrollHeight;
    const X = (d: number) => 16 + d * 22;
    this.pos = new Map();
    for (const el of trail.querySelectorAll<HTMLElement>(".s-detour > summary, .s-stop")) {
      if (!el.offsetParent) continue;
      const n = this.map.byId.get(el.closest<HTMLElement>("[data-id]")!.dataset.id!);
      if (n && !this.pos.has(n)) this.pos.set(n, { x: X(n.level - 2), y: el.getBoundingClientRect().top - top + 24 });
    }
    const paths: { d: string; detour: boolean }[] = [];
    const pos = this.pos, root = this.map.root;
    (function chain(n: MapNode) {
      const p = n === root ? null : pos.get(n) ?? null;
      let prev = p;
      for (const c of n.seq) {
        const q = pos.get(c);
        if (!q) continue;
        if (prev === p && p) paths.push({ d: `M${p.x} ${p.y} C${p.x} ${p.y + 18} ${q.x} ${p.y + 8} ${q.x} ${p.y + 28} L${q.x} ${q.y}`, detour: c.detour });
        else if (prev) paths.push({ d: `M${prev.x} ${prev.y} L${q.x} ${q.y}`, detour: c.detour });
        prev = q;
        chain(c);
      }
    })(root);
    const pathEls = paths.map(p => `<path d="${p.d}"${p.detour ? ' class="detour"' : ""}/>`).join("");
    const dots = [...pos].map(([n, p]) => `<circle cx="${p.x}" cy="${p.y}" r="${n.level <= 2 ? 6 : 4.5}" data-id="${esc(n.id)}"/>`).join("");
    svg.setAttribute("viewBox", `0 0 120 ${H}`);
    svg.style.height = `${H}px`;
    svg.innerHTML = `<defs><clipPath id="s-clip"><rect id="s-clip-r" x="-20" y="0" width="160" height="0"/></clipPath></defs><g class="unlit">${pathEls}</g><g class="lit" clip-path="url(#s-clip)">${pathEls}</g><g class="dots">${dots}</g>`;
    for (const c of svg.querySelectorAll("circle")) {
      const p = pos.get(this.map.byId.get(c.dataset.id!)!);
      if (p) p.el = c;
    }
  }

  onScroll(): void {
    const trail = document.getElementById("s-trail");
    if (!trail) return;
    const line = this.el.getBoundingClientRect().top + this.el.clientHeight * 0.4 - trail.getBoundingClientRect().top;
    document.getElementById("s-clip-r")?.setAttribute("height", String(Math.max(0, line)));
    let cur: MapNode | null = null, curY = -Infinity;
    for (const [n, p] of this.pos) {
      const on = p.y <= line;
      p.el?.classList.toggle("on", on);
      if (on && p.y >= curY) { cur = n; curY = p.y; }
    }
    this.current = cur;
    const crumb = document.getElementById("s-crumb");
    if (crumb) crumb.innerHTML = cur ? crumbsHtml(cur) : `<b>${esc(this.map.root.stop.title)}</b>`;
  }

  /** Brings a stop to the reading line, opening its detour if it's folded away. */
  scrollTo(n: MapNode): void {
    let el: HTMLElement | null = document.getElementById(`s-${n.id}`);
    const det = el?.closest("details");
    if (det && !det.open) { det.open = true; this.drawRails(); }
    if (n === this.map.root || !el) { this.el.scrollTo({ top: 0 }); return; }
    if (det && el === det.querySelector(".s-stop")) el = det;
    const y = el.getBoundingClientRect().top - this.el.getBoundingClientRect().top + this.el.scrollTop - 64;
    this.el.scrollTo({ top: y, behavior: this.reducedMotion ? "auto" : "smooth" });
  }
}
