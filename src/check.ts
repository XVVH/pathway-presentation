// `pathway check`: parse a deck and its notes, then report everything that
// would break it or make it hard to follow, each with a line number and, where
// there is one, a fix.

import { estimateStop, type Estimate } from "./layout.ts";
import type { Io } from "./io.ts";
import { imageSize } from "./media.ts";
import type { Deck, Diagnostic, Edit, Fix, Notes, Stop } from "./model.ts";
import { defaultNotesPath, parseNotes } from "./notes.ts";
import { parseDeck } from "./parse.ts";
import { resolveSkin, type ResolvedSkin } from "./skin.ts";
import { closest, plural, slugify } from "./text.ts";
import { DENSITY } from "./typography.ts";

export interface CheckOptions {
  /** Path to the notes file; null to skip notes; undefined for the default. */
  notes?: string | null;
}

export interface Summary {
  errors: number;
  warnings: number;
  infos: number;
  stops: number;
  detours: number;
  /** Stops with a notes section, when there is a notes file. */
  withNotes: number | null;
}

export interface CheckResult {
  deck: Deck;
  skin: ResolvedSkin;
  notes: Notes | null;
  estimates: Map<string, Estimate>;
  diagnostics: Diagnostic[];
  summary: Summary;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export function checkDeck(deckPath: string, io: Io, opts: CheckOptions = {}): CheckResult {
  const source = io.read(deckPath);
  if (source === null) throw new Error(`Can't read ${deckPath}`);
  const deck = parseDeck(source, deckPath);
  const file = deckPath;
  const out: Diagnostic[] = [...deck.diagnostics];
  const dir = io.dirname(deckPath);
  const ids = [...deck.byId.keys()];
  const byTitle = new Map(deck.stops.map(s => [slugify(s.title), s.id]));
  /** A likely intended stop id: same title, or a near-miss spelling. */
  const guessId = (written: string): { id: string; sure: boolean } | null => {
    const sameTitle = byTitle.get(slugify(written));
    if (sameTitle) return { id: sameTitle, sure: true };
    const near = closest(written, ids);
    return near ? { id: near, sure: false } : null;
  };

  // [[links]] must point at stops.
  for (const stop of deck.stops) {
    for (const link of stop.links) {
      if (deck.byId.has(link.target)) continue;
      const guess = guessId(link.target);
      const original = deck.lines[link.line - 1];
      out.push({
        code: "broken-link", severity: "error", file, line: link.line, column: link.column, stop: stop.id,
        message: `[[${link.target}]] doesn't match any stop.${guess ? ` Did you mean [[${guess.id}]]${guess.sure ? `, the id of "${deck.byId.get(guess.id)!.title}"` : ""}?` : " Links use a stop's id."}`,
        fix: guess ? {
          description: `Link to [[${guess.id}]].`, safe: guess.sure,
          edits: [{ file, startLine: link.line, endLine: link.line + 1, newText: original.replace(`[[${link.target}`, `[[${guess.id}`) }],
        } : undefined,
      });
    }
  }

  // Media must exist, travel with the deck, and be something Pathway can show.
  const aspects = new Map<string, number | null>();
  const aspectOf = (src: string): number | null => {
    if (!aspects.has(src)) {
      const bytes = io.head(io.join(dir, src), 64 * 1024);
      const size = bytes ? imageSize(bytes) : null;
      aspects.set(src, size && size.width > 0 ? size.height / size.width : null);
    }
    return aspects.get(src)!;
  };
  for (const stop of deck.stops) {
    for (const m of stop.media) {
      if (m.remote) {
        if (!m.src.startsWith("data:")) out.push({ code: "remote-media", severity: "warning", file, line: m.line, stop: stop.id, message: `'${m.src}' is loaded from the network, so it fails offline and can't be rendered into video. Download it into the deck's media folder.` });
        continue;
      }
      if (m.src.startsWith("/")) {
        out.push({ code: "absolute-media-path", severity: "warning", file, line: m.line, stop: stop.id, message: `'${m.src}' is an absolute path, so it breaks when the deck moves. Use a path relative to the deck, like media/${m.src.split("/").pop()}.` });
      } else if (m.src.split(/[\\/]/).includes("..")) {
        out.push({ code: "media-outside-deck", severity: "warning", file, line: m.line, stop: stop.id, message: `'${m.src}' is outside the deck's folder, so it won't travel with the deck. Move it into the deck's media folder.` });
      }
      const path = m.src.startsWith("/") ? m.src : io.join(dir, m.src);
      if (!io.exists(path)) {
        const folder = io.dirname(m.src);
        const near = closest(m.src.split("/").pop() ?? m.src, io.list(io.join(dir, folder)));
        const suggestion = near ? (folder === "." ? near : `${folder}/${near}`) : null;
        out.push({
          code: "missing-media", severity: "error", file, line: m.line, stop: stop.id,
          message: `'${m.src}' doesn't exist.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
          fix: suggestion ? { description: `Use '${suggestion}'.`, safe: false, edits: [{ file, startLine: m.line, endLine: m.line + 1, newText: deck.lines[m.line - 1].replace(m.src, suggestion) }] } : undefined,
        });
      }
      if (m.kind === "unknown") out.push({ code: "unsupported-media", severity: "warning", file, line: m.line, stop: stop.id, message: `Pathway doesn't know how to show '${m.src}'. Images: .png .jpg .gif .webp .avif .svg. Video: .mp4 .webm .mov.` });
    }
  }

  // Named routes must list real stops.
  for (const route of deck.meta.routes) {
    if (!route.stops.length) out.push({ code: "route-empty", severity: "error", file, line: route.line, message: `Route '${route.name}' has no stops.` });
    const seen = new Set<string>();
    for (const s of route.stops) {
      if (seen.has(s.id)) out.push({ code: "route-duplicate-stop", severity: "warning", file, line: s.line, message: `Route '${route.name}' visits '${s.id}' twice.` });
      seen.add(s.id);
      if (deck.byId.has(s.id)) continue;
      const guess = guessId(s.id);
      out.push({
        code: "route-unknown-stop", severity: "error", file, line: s.line,
        message: `Route '${route.name}' lists '${s.id}', which isn't a stop id.${guess ? ` Did you mean '${guess.id}'?` : ""}`,
        fix: guess ? { description: `Use '${guess.id}'.`, safe: guess.sure, edits: [{ file, startLine: s.line, endLine: s.line + 1, newText: deck.lines[s.line - 1].replace(new RegExp(`(^|[\\s\\[,-])${escapeRe(s.id)}(?=$|[\\s\\],])`), `$1${guess.id}`) }] } : undefined,
      });
    }
  }

  // The skin, and its fonts' widths, which every size estimate depends on.
  const skin = resolveSkin(deck.meta.skin, file, io, deck.meta.skinLine);
  for (const d of skin.diagnostics) if (!out.some(o => o.code === d.code && o.message === d.message)) out.push(d);

  // How much each stop holds: an error when it can't fit, a warning when it's
  // more than people can read while listening.
  const estimates = new Map<string, Estimate>();
  for (const stop of deck.stops) {
    const density = stop.density ?? deck.meta.density;
    const spec = DENSITY[density];
    const est = estimateStop(stop, { metrics: skin.metrics, density, isRoot: stop === deck.root, aspect: m => aspectOf(m.src) });
    estimates.set(stop.id, est);
    const advice = splitAdvice(stop, deck, file);
    if (est.overflow) {
      out.push({
        code: "stop-overflow", severity: "error", file, line: stop.line, stop: stop.id,
        message: `"${stop.title}" holds more than a stop can show at reading size: about ${plural(est.overflowLines, "line")} too many at ${density} density.`,
        fix: advice,
      });
    } else {
      if (stop.words > spec.warn.words) out.push({
        code: "stop-dense", severity: "warning", file, line: stop.line, stop: stop.id,
        message: `"${stop.title}" has ${stop.words} words of body text. At ${density} density, aim for ${spec.warn.words} or fewer: people read while they listen.`,
        fix: advice,
      });
      const bullets = stop.blocks.reduce((a, b) => a + (b.kind === "list" ? b.items.filter(i => i.depth === 0).length : 0), 0);
      if (bullets > spec.warn.bullets) out.push({
        code: "too-many-bullets", severity: "warning", file, line: stop.line, stop: stop.id,
        message: `"${stop.title}" has ${bullets} bullets. At ${density} density, aim for ${spec.warn.bullets} or fewer.`,
        fix: advice,
      });
      const codeLines = stop.blocks.reduce((a, b) => a + (b.kind === "code" ? b.lines.length : 0), 0);
      if (codeLines > spec.warn.codeLines) out.push({
        code: "long-code", severity: "warning", file, line: stop.line, stop: stop.id,
        message: `"${stop.title}" shows ${codeLines} lines of code. At ${density} density, aim for ${spec.warn.codeLines} or fewer, or make it a detour.`,
      });
    }
    const figures = stop.media.filter(m => !m.inline).length;
    if (figures > spec.warn.media) out.push({ code: "multiple-media", severity: "warning", file, line: stop.line, stop: stop.id, message: `"${stop.title}" has ${figures} images or videos. A stop shows one well; give the others their own stops.` });
    for (const c of est.clippedCode) out.push({ code: "code-line-clipped", severity: "warning", file, line: c.line, stop: stop.id, message: `This code line is ${c.length} characters; about ${c.max} fit across the card at ${density} density, so the rest is cut off.` });
    if (stop !== deck.root && !stop.blocks.length && !stop.children.length) out.push({ code: "empty-stop", severity: "warning", file, line: stop.line, stop: stop.id, message: `"${stop.title}" has a title and nothing else. Add a line of content, or fold it into its neighbour.` });
    if (stop.depth >= 4) out.push({ code: "too-deep", severity: "warning", file, line: stop.line, stop: stop.id, message: `"${stop.title}" is ${stop.depth} levels below the title. Audiences lose their place beyond 3; consider a detour or a flatter branch.` });
  }

  // Speaker notes: every section should match a stop.
  let notes: Notes | null = null;
  const notesPath = opts.notes === null ? null : opts.notes ?? (deck.meta.notes ? io.join(dir, deck.meta.notes) : defaultNotesPath(deckPath));
  if (notesPath) {
    const text = io.read(notesPath);
    if (text === null) {
      if (opts.notes || deck.meta.notes) out.push({ code: "notes-file-missing", severity: "error", file, line: 1, message: `The notes file '${notesPath}' doesn't exist.` });
    } else {
      notes = parseNotes(text, notesPath);
      out.push(...notes.diagnostics);
      const claimed = new Map<string, number>();
      // Titles can repeat across stops; a title that names more than one stop names none.
      const stopsByTitle = new Map<string, Stop[]>();
      for (const st of deck.stops) stopsByTitle.set(slugify(st.title), [...(stopsByTitle.get(slugify(st.title)) ?? []), st]);
      for (const s of notes.sections) {
        // An explicit {#id} names the stop; otherwise the title must match a stop's title (or id).
        const sameTitle = s.explicitId ? [] : stopsByTitle.get(slugify(s.title)) ?? [];
        if (sameTitle.length > 1) {
          out.push({
            code: "notes-ambiguous", severity: "warning", file: notesPath, line: s.line,
            message: `Notes for '${s.title}' could belong to ${sameTitle.length} stops with that title (lines ${sameTitle.map(x => x.line).join(", ")}), so they aren't shown. Add the id of the one you mean: ${sameTitle.map(x => `{#${x.id}}`).join(" or ")}.`,
          });
          continue;
        }
        const target = s.explicitId ? (deck.byId.has(s.id) ? s.id : null) : sameTitle[0]?.id ?? (deck.byId.has(s.id) ? s.id : null);
        if (target) {
          s.id = target;
          s.matched = true;
          const stop = deck.byId.get(target)!;
          const prev = claimed.get(target);
          if (prev !== undefined) out.push({ code: "notes-duplicate", severity: "warning", file: notesPath, line: s.line, stop: target, message: `Notes for "${stop.title}" already start on line ${prev}. Merge the two sections.` });
          else if (stop.notes.length) out.push({ code: "notes-duplicate", severity: "warning", file: notesPath, line: s.line, stop: target, message: `"${stop.title}" also has notes in the deck (line ${stop.notes[0].line}). Both are shown, one after the other; keep them in one place.` });
          claimed.set(target, prev ?? s.line);
          continue;
        }
        const guess = guessId(s.title) ?? guessId(s.id);
        out.push({
          code: "notes-orphan", severity: "warning", file: notesPath, line: s.line,
          message: `Notes for '${s.title}' don't match any stop, so they'd be lost.${guess ? ` Did you mean "${deck.byId.get(guess.id)!.title}"? Add {#${guess.id}} to this heading.` : " Match a stop's title, or add its {#id}."}`,
        });
      }
    }
  }

  out.sort((a, b) => (a.file === b.file ? 0 : a.file === file ? -1 : b.file === file ? 1 : a.file < b.file ? -1 : 1)
    || a.line - b.line || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.column ?? 0) - (b.column ?? 0));
  const count = (s: Diagnostic["severity"]) => out.filter(d => d.severity === s).length;
  // Notes written in the deck count as much as notes in a separate file.
  const noted = new Set([...deck.stops.filter(st => st.notes.length).map(st => st.id), ...(notes?.sections.filter(n => n.matched).map(n => n.id) ?? [])]);
  const anyNotes = !!notes || deck.stops.some(st => st.notes.length);
  return {
    deck, skin, notes, estimates, diagnostics: out,
    summary: {
      errors: count("error"), warnings: count("warning"), infos: count("info"),
      stops: deck.stops.length, detours: deck.stops.filter(s => s.detour).length,
      withNotes: anyNotes ? deck.stops.filter(st => noted.has(st.id)).length : null,
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How to lighten a crowded stop. Content moves; it isn't cut. */
function splitAdvice(stop: Stop, deck: Deck, file: string): Fix {
  const list = stop.blocks.find(b => b.kind === "list" && b.items.filter(i => i.depth === 0 && i.leadIn).length >= 2);
  if (list && list.kind === "list") {
    const items = list.items.filter(i => i.depth === 0);
    const hashes = "#".repeat(Math.min(6, stop.level + 1));
    const children = items.map(i => `\n${hashes} ${i.leadIn ?? i.text}\n${i.leadIn ? `${i.rest}\n` : ""}`).join("");
    const edits: Edit[] = [
      { file, startLine: stop.endLine + 1, endLine: stop.endLine + 1, newText: children },
      { file, startLine: list.line, endLine: list.endLine + 1, newText: "" },
    ];
    return {
      description: `Its bullets open with bold phrases, so each is really a stop. Make them ${plural(items.length, `${hashes} stop`)} under "${stop.title}", and leave a one-line summary here.`,
      safe: false, edits,
    };
  }
  const paragraphs = stop.blocks.filter(b => b.kind === "paragraph").length;
  if (paragraphs >= 2) return { description: `Keep the first paragraph on screen and move the other ${paragraphs - 1} into the speaker notes under "${stop.title}", or into child stops.`, safe: false };
  return { description: "Move detail into the speaker notes, or into child stops one level down.", safe: false };
}
