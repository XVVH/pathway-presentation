// Checked deck to payload: everything the browser needs to draw the map and
// travel it, with card sizes fixed here so the map is the same on every screen.

import type { CheckResult } from "./check.ts";
import { renderBody, escapeHtml } from "./html.ts";
import { joinPosix, type Io } from "./io.ts";
import { imageSize } from "./media.ts";
import type { Deck, MediaRef, Stop } from "./model.ts";
import type { Payload, PayloadFigure, PayloadRoute, PayloadStop, Target } from "./payload.ts";
import { qrSvg } from "./qr.ts";
import { defaultRoute } from "./routes.ts";
import { CARD } from "./typography.ts";

export interface CompileOptions {
  /** Include speaker notes. Off unless asked for: notes are private. */
  notes?: boolean;
  /** Served by `pathway present`. */
  dev?: boolean;
  /** Where the audience copy will live, overriding the deck's `url`. */
  url?: string;
}

export interface Compiled {
  payload: Payload;
  /** Media files the page uses, as paths relative to the deck's folder. */
  media: string[];
}

const bodyLines = (lines: readonly string[], from: number, to: number) => lines.slice(from, Math.max(from, to)).join("\n");

/** Media the page can load: a file inside the deck's folder that exists, or inline data. */
function figure(m: MediaRef, deck: Deck, io: Io, media: Set<string>): PayloadFigure {
  const base = { alt: m.alt, loop: m.attrs.loop !== undefined, wide: m.classes.includes("wide") };
  const missing = (why: string): PayloadFigure => ({ ...base, kind: "missing", src: "", note: `${m.src}: ${why}` });
  if (m.src.startsWith("data:")) {
    const kind = /^data:image\//i.test(m.src) ? "image" : /^data:video\//i.test(m.src) ? "video" : null;
    return kind ? { ...base, kind, src: m.src } : missing("not an image or video");
  }
  if (m.remote) return missing("not included, because it loads from the network");
  if (m.kind === "unknown") return missing("not a format Pathway shows");
  if (m.src.startsWith("/") || m.src.split(/[\\/]/).includes("..")) return missing("outside the deck's folder");
  const path = io.join(io.dirname(deck.file), m.src);
  if (!io.exists(path)) return missing("file not found");
  const rel = joinPosix(m.src.replace(/\\/g, "/"));
  media.add(rel);
  const fig: PayloadFigure = { ...base, kind: m.kind, src: rel.split("/").map(encodeURIComponent).join("/") };
  const head = m.kind === "image" ? io.head(path, 64 * 1024) : null;
  const size = head ? imageSize(head) : null;
  if (size && size.width > 0 && size.height > 0) { fig.width = size.width; fig.height = size.height; }
  return fig;
}

export function compileDeck(result: CheckResult, io: Io, opts: CompileOptions = {}): Compiled {
  const { deck } = result;
  const root = deck.root;
  if (!root) throw new Error("The deck has no # title, so there's nowhere for the route to start.");
  const titles = new Map(deck.stops.map(s => [s.id, s.title]));
  const route: Target[] = defaultRoute(deck);
  const numbers = new Map<string, number>();
  for (const t of route) if (t.kind === "stop" && t.id !== root.id) numbers.set(t.id, numbers.size + 1);
  const media = new Set<string>();
  // A stop's level is its distance from the title, whatever its heading says:
  // a skipped level is an error the checker reports, and the map stays whole.
  const stops: PayloadStop[] = deck.stops.map((s: Stop) => ({
    id: s.id, title: s.title, level: s.depth + 1, parent: s.parent, children: s.children, detour: s.detour,
    number: numbers.get(s.id) ?? null,
    ratio: result.estimates.get(s.id)?.fitted ?? CARD.ratioMax,
    density: s.density ?? deck.meta.density,
    words: s.words,
    body: renderBody(bodyLines(deck.lines, s.line, s.endLine), { titles }),
    figures: s.media.filter(m => !m.inline).map(m => figure(m, deck, io, media)),
  }));
  const routes: PayloadRoute[] = deck.meta.routes.map(r => {
    const ids = r.stops.map(s => s.id).filter(id => deck.byId.has(id));
    const targets: Target[] = [{ kind: "map" }];
    if (ids[0] !== root.id) targets.push({ kind: "stop", id: root.id });
    for (const id of ids) targets.push({ kind: "stop", id });
    targets.push({ kind: "map", final: true });
    return { name: r.name, targets };
  });

  let notes: Record<string, string> | null = null;
  if (opts.notes) {
    notes = {};
    const add = (id: string, html: string) => { if (html) notes![id] = notes![id] ? `${notes![id]}\n${html}` : html; };
    // Notes written in the deck, under their stop...
    for (const s of deck.stops) {
      for (const n of s.notes) add(s.id, renderBody(bodyLines(deck.lines, n.line, n.closed ? n.endLine - 1 : n.endLine), { titles }));
    }
    // ...then any from a separate notes file, matched by the checker.
    const text = result.notes ? io.read(result.notes.file) : null;
    if (result.notes && text !== null) {
      const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
      for (const s of result.notes.sections) if (s.matched) add(s.id, renderBody(bodyLines(lines, s.line, s.endLine), { titles }));
    }
  }

  // The bottom line: the title stop's takeaways.
  const bottomLine = root.takeaways.map(t => renderBody(bodyLines(deck.lines, t.line, t.closed ? t.endLine - 1 : t.endLine), { titles })).filter(Boolean).join("\n");
  const url = opts.url ?? deck.meta.url;

  return {
    payload: {
      version: 1, title: deck.meta.title ?? root.title, skin: result.skin.file ? `custom (${result.skin.base})` : result.skin.base, bend: result.skin.bend,
      stops, route, routes, notes,
      takeaways: bottomLine || null,
      handoff: url ? { url, qr: qrSvg(url) } : null,
      dev: !!opts.dev,
    },
    media: [...media].sort(),
  };
}

/** The payload as a JSON script element's text, safe to embed in HTML. */
export function payloadScript(payload: Payload): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export { escapeHtml };
