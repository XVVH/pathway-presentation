// Cards: each stop's content, laid out once at reading size and moved only by
// the camera. Nothing on a card resizes or rewraps. When a line of text gets
// too small to read, it dissolves into a bar the exact shape of itself
// (greeking), and resolves back into words as you come closer.

import type { PayloadFigure } from "../payload.ts";
import type { Cam } from "./math.ts";
import { smoothstep } from "./math.ts";
import type { MapNode, WorldMap } from "./map.ts";
import { esc, pad2 } from "./dom.ts";

export function eyebrowHtml(n: MapNode, map: WorldMap): string {
  if (n === map.root) return "";
  const parent = n.parent && n.parent !== map.root ? `<span class="parent">${esc(n.parent.stop.title)}</span>` : "";
  const mark = n.detour || n.stop.number === null ? '<span class="tag">Detour</span>' : `<span class="num">Stop ${pad2(n.stop.number)}</span>`;
  return `<header class="eyebrow">${mark}${parent}</header>`;
}

export function figureHtml(f: PayloadFigure): string {
  const caption = f.alt ? `<figcaption>${esc(f.alt)}</figcaption>` : "";
  if (f.kind === "video") return `<figure><video muted playsinline${f.loop ? " loop" : ""} preload="none" data-src="${esc(f.src)}" aria-label="${esc(f.alt)}"></video>${caption}</figure>`;
  if (f.kind === "image") {
    const size = f.width && f.height ? ` width="${f.width}" height="${f.height}"` : "";
    return `<figure><img src="${esc(f.src)}" alt="${esc(f.alt)}"${size} decoding="async"></figure>`;
  }
  return `<figure><div class="missing" role="img" aria-label="${esc(f.alt)}">${esc(f.note ?? "Media not available")}</div></figure>`;
}

/** The readable part of a card: eyebrow, title, text and figures. */
export function stopHtml(n: MapNode, map: WorldMap, titleTag = n === map.root ? "h1" : "h2"): string {
  const figs = n.stop.figures.length ? `<div class="figs">${n.stop.figures.map(figureHtml).join("")}</div>` : "";
  return `${eyebrowHtml(n, map)}<${titleTag}>${esc(n.stop.title)}</${titleTag}><div class="md">${n.stop.body}</div>${figs}`;
}

export function cardClasses(n: MapNode, map: WorldMap): string {
  const figs = n.stop.figures;
  return ["card", n === map.root && "root", n.detour && "detour", figs.length && "has-media", figs.some(f => f.wide) && "wide-media", n.stop.density !== "talk" && `d-${n.stop.density}`]
    .filter(Boolean).join(" ");
}

/** On-screen type size, in px, at which each kind of text crossfades with its bars. */
const LOD_RANGE = { title: [5.8, 7], eyebrow: [6.4, 7.6], code: [6.4, 7.6], caption: [6.4, 7.6], body: [7, 8] } as const;
type Kind = keyof typeof LOD_RANGE;

interface Lod { el: HTMLElement; px: number; range: readonly [number, number]; bars: HTMLElement | null }

interface CardState {
  node: MapNode;
  el: HTMLElement;
  video: HTMLVideoElement | null;
  lod: Lod[];
  op: Map<string, number>;
  visible: boolean | null;
}

export interface CardView {
  cam: Cam & { fade: number };
  vw: number;
  vh: number;
  cw: number;
  /** The stop the camera is at or heading for. */
  focus: string | null;
  /** True once the camera has arrived. */
  settled: boolean;
  /** Whether videos may play (not while scrubbing a paused tour, nor while capturing). */
  playing: boolean;
}

export class Cards {
  readonly states: CardState[] = [];
  private measuredFor = "";

  constructor(world: HTMLElement, map: WorldMap) {
    for (const node of map.nodes) {
      const el = document.createElement("article");
      el.className = cardClasses(node, map);
      el.dataset.id = node.id;
      el.style.setProperty("--ratio", String(node.stop.ratio));
      el.innerHTML = `<div class="read">${stopHtml(node, map)}</div><div class="bars" aria-hidden="true"></div>`;
      world.appendChild(el);
      this.states.push({ node, el, video: el.querySelector("video"), lod: [], op: new Map(), visible: null });
    }
  }

  /** Everything the cards show has loaded: fonts and images. */
  ready(): Promise<unknown> {
    const imgs = this.states.flatMap(s => [...s.el.querySelectorAll("img")]);
    return Promise.all([document.fonts.ready, ...imgs.map(img => img.decode().catch(() => undefined))]);
  }

  /** Measures every line of text at reading size and lays a bar over each. Redone when the card width changes. */
  measureLines(key: string): void {
    if (key === this.measuredFor) return;
    this.measuredFor = key;
    for (const s of this.states) {
      const card = s.el, keep = card.style.transform;
      card.style.transform = "none";
      const box = card.getBoundingClientRect(), ox = box.left + card.clientLeft, oy = box.top + card.clientTop;
      const groups: string[] = [], lod: Lod[] = [];
      for (const el of card.querySelectorAll<HTMLElement>(".read .eyebrow, .read h1, .read h2, .read .md p, .read .md li, .read .md pre, .read .md blockquote, .read .md th, .read .md td, .read figcaption, .read .missing")) {
        if (el.closest("li") && el.tagName === "P") continue;
        if (el.closest("blockquote") && el !== el.closest("blockquote")) continue;
        const kind: Kind = el.matches(".eyebrow") ? "eyebrow" : el.matches("h1, h2") ? "title" : el.matches("pre") ? "code" : el.matches("figcaption, .missing") ? "caption" : "body";
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const bars = lineBoxes(el, el.tagName === "LI").map((L, j) => {
          const h = fs * (kind === "title" ? 0.62 : 0.5), y = L.top + (L.bottom - L.top - h) / 2;
          let b = bar(L.left - ox, y - oy, L.right - L.left, h);
          if (el.tagName === "LI" && j === 0) {
            const d = fs * 0.36;
            b += bar(L.left - ox - fs * 0.95, L.top + (L.bottom - L.top - d) / 2 - oy, d, d, "dot");
          }
          return b;
        }).join("");
        groups.push(`<div class="bg ${kind}" style="opacity:0">${bars}</div>`);
        lod.push({ el, px: fs, range: LOD_RANGE[kind], bars: null });
      }
      const layer = card.querySelector<HTMLElement>(".bars")!;
      layer.innerHTML = groups.join("");
      [...layer.children].forEach((g, i) => { lod[i].bars = g as HTMLElement; });
      for (const L of lod) L.el.style.opacity = "";
      s.lod = lod;
      s.op.clear();
      card.style.transform = keep;
    }
  }

  /** Cards whose content is taller than the size the build gave them. */
  overflowing(): string[] {
    return this.states.filter(s => {
      const read = s.el.querySelector<HTMLElement>(".read");
      return !!read && read.scrollHeight > read.clientHeight + 2;
    }).map(s => s.node.id);
  }

  update(v: CardView): void {
    const k = v.vw / v.cam.w;
    for (const s of this.states) {
      const n = s.node;
      const sx = (n.x - v.cam.x) * k + v.vw / 2, sy = (n.y - v.cam.y) * k + v.vh / 2, sw = n.ww * k, sh = n.wh * k;
      const onScreen = sx + sw / 2 > -40 && sx - sw / 2 < v.vw + 40 && sy + sh / 2 > -40 && sy - sh / 2 < v.vh + 40;
      const op = smoothstep(8, 30, sw) * v.cam.fade;
      if (!onScreen || op <= 0.01) {
        if (s.visible !== false) { s.el.style.visibility = "hidden"; s.visible = false; }
      } else {
        if (s.visible !== true) { s.el.style.visibility = "visible"; s.visible = true; }
        s.el.style.transform = `translate(${(sx - sw / 2).toFixed(2)}px, ${(sy - sh / 2).toFixed(2)}px) scale(${(sw / v.cw).toFixed(5)})`;
        setOp(s, "card", s.el, op);
        const sc = sw / v.cw;
        s.lod.forEach((L, i) => {
          const t = smoothstep(L.range[0], L.range[1], L.px * sc);
          setOp(s, `t${i}`, L.el, t);
          if (L.bars) setOp(s, `b${i}`, L.bars, 1 - t);
        });
      }
      if (s.video) {
        if (sw > 140 || n.id === v.focus) loadVideo(s.video);
        const play = v.playing && n.id === v.focus && v.settled;
        if (play && s.video.paused) s.video.play().catch(() => undefined);
        if (!play && !s.video.paused) s.video.pause();
      }
    }
  }
}

export function loadVideo(v: HTMLVideoElement): void {
  if (v.dataset.loaded || !v.dataset.src) return;
  v.dataset.loaded = "1";
  v.preload = "auto";
  v.src = v.dataset.src;
  v.load();
}

function setOp(s: CardState, key: string, el: HTMLElement, value: number): void {
  const q = Math.round(value * 50) / 50;
  if (s.op.get(key) === q) return;
  s.op.set(key, q);
  el.style.opacity = String(q);
}

const bar = (x: number, y: number, w: number, h: number, cls = "") =>
  `<span class="bar${cls ? ` ${cls}` : ""}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px"></span>`;

interface LineBox { top: number; bottom: number; left: number; right: number }

/** The boxes of each rendered line of an element's text, merged per line. */
function lineBoxes(el: HTMLElement, ownTextOnly: boolean): LineBox[] {
  const r = document.createRange();
  const lines: LineBox[] = [];
  const add = (q: DOMRect) => {
    if (q.width < 0.5 || q.height < 0.5) return;
    const L = lines.find(l => Math.abs(l.top - q.top) < 3 || (q.top >= l.top - 1 && q.bottom <= l.bottom + 1));
    if (L) { L.left = Math.min(L.left, q.left); L.right = Math.max(L.right, q.right); L.top = Math.min(L.top, q.top); L.bottom = Math.max(L.bottom, q.bottom); }
    else lines.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right });
  };
  if (!ownTextOnly) {
    r.selectNodeContents(el);
    for (const q of r.getClientRects()) add(q);
    return lines;
  }
  // A list item's own text, not its nested list (which has its own items).
  for (const child of el.childNodes) {
    if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) continue;
    r.selectNodeContents(child);
    if (child.nodeType === Node.TEXT_NODE) r.selectNode(child);
    for (const q of r.getClientRects()) add(q);
  }
  return lines;
}
