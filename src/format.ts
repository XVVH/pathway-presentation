// Output for people (aligned, optionally coloured) and for agents (JSON).

import type { CheckResult } from "./check.ts";
import type { Diagnostic } from "./model.ts";
import { defaultRoute, type RouteStop } from "./routes.ts";
import { plural } from "./text.ts";

export interface Style { color: boolean }
const paint = (on: boolean, code: string) => (s: string) => (on ? `\u001b[${code}m${s}\u001b[0m` : s);

export function formatCheck(r: CheckResult, style: Style): string {
  const red = paint(style.color, "31"), yellow = paint(style.color, "33"), blue = paint(style.color, "34");
  const dim = paint(style.color, "2"), bold = paint(style.color, "1"), green = paint(style.color, "32");
  const sev = { error: red, warning: yellow, info: blue };
  const out: string[] = [];
  const loc = (d: Diagnostic) => `${d.line}${d.column ? `:${d.column}` : ""}`;
  const locW = Math.max(0, ...r.diagnostics.map(d => loc(d).length));
  const codeW = Math.max(0, ...r.diagnostics.map(d => d.code.length));
  let current = "";
  for (const d of r.diagnostics) {
    if (d.file !== current) { if (current) out.push(""); out.push(bold(d.file)); current = d.file; }
    const indent = `  ${" ".repeat(locW)}  ${" ".repeat(7)}  ${" ".repeat(codeW)}  `;
    out.push(`  ${dim(loc(d).padStart(locW))}  ${sev[d.severity](d.severity.padEnd(7))}  ${dim(d.code.padEnd(codeW))}  ${d.message}`);
    if (d.fix) out.push(`${indent}${dim(`→ ${d.fix.description}${d.fix.safe ? " (pathway check --fix applies this)" : ""}`)}`);
  }
  const s = r.summary;
  const counts = [s.errors && plural(s.errors, "error"), s.warnings && plural(s.warnings, "warning"), s.infos && plural(s.infos, "note")].filter(Boolean).join(", ");
  const facts = [plural(s.stops, "stop"), s.detours ? plural(s.detours, "detour") : null, s.withNotes !== null ? `notes for ${s.withNotes} of ${s.stops}` : "no notes file"].filter(Boolean).join(" · ");
  if (out.length) out.push("");
  out.push(s.errors ? `${red("✖")} ${counts} · ${facts}` : s.warnings || s.infos ? `${yellow("!")} ${counts} · ${facts}` : `${green("✓")} No problems · ${facts}`);
  return out.join("\n");
}

export function checkJson(r: CheckResult) {
  return { version: 1, deck: r.deck.file, notes: r.notes?.file ?? null, summary: r.summary, diagnostics: r.diagnostics };
}

const routeLabel = (s: RouteStop) => (s.kind === "map" ? (s.final ? "whole map" : "map") : s.kind === "lookback" ? `↩ ${s.id}` : s.id);

export function formatOutline(r: CheckResult, style: Style): string {
  const dim = paint(style.color, "2"), bold = paint(style.color, "1");
  const { deck } = r;
  const out: string[] = [];
  const line = (prefix: string, id: string) => {
    const s = deck.byId.get(id)!;
    const est = r.estimates.get(id);
    const tags = [s.detour ? "detour" : null, s.density ? s.density : null, est?.overflow ? "too long" : null].filter(Boolean).join(", ");
    out.push(`${prefix}${s.title}  ${dim(`#${s.id} · ${plural(s.words, "word")}${tags ? ` · ${tags}` : ""}`)}`);
  };
  const walk = (ids: string[], indent: string) => ids.forEach((id, k) => {
    const last = k === ids.length - 1;
    line(`${indent}${last ? "└─ " : "├─ "}`, id);
    walk(deck.byId.get(id)!.children, `${indent}${last ? "   " : "│  "}`);
  });
  if (deck.root) { line("", deck.root.id); walk(deck.root.children, ""); }
  else walk(deck.stops.filter(s => s.parent === null).map(s => s.id), "");
  out.push("", `${bold("Route")} ${dim("(default)")}`, `  ${defaultRoute(deck).map(routeLabel).join(dim(" › "))}`);
  if (deck.meta.routes.length) {
    out.push("", bold("Named routes"));
    for (const rt of deck.meta.routes) out.push(`  ${rt.name}: ${rt.stops.map(s => s.id).join(dim(" › "))}`);
  }
  return out.join("\n");
}

export function outlineJson(r: CheckResult) {
  const { deck } = r;
  return {
    version: 1,
    deck: deck.file,
    meta: { title: deck.meta.title ?? null, skin: deck.meta.skin, density: deck.meta.density, notes: r.notes?.file ?? null },
    stops: deck.stops.map(s => {
      const est = r.estimates.get(s.id)!;
      return {
        id: s.id, title: s.title, line: s.line, level: s.level, depth: s.depth, parent: s.parent, children: s.children,
        detour: s.detour, density: s.density, words: s.words,
        bullets: s.blocks.reduce((a, b) => a + (b.kind === "list" ? b.items.filter(i => i.depth === 0).length : 0), 0),
        media: s.media.map(m => ({ src: m.src, kind: m.kind, wide: m.classes.includes("wide"), line: m.line })),
        links: s.links.map(l => l.target),
        hasNotes: r.notes ? r.notes.sections.some(n => n.id === s.id) : null,
        card: { ratio: Number(est.ratio.toFixed(3)), fitted: est.fitted, layout: est.layout, overflow: est.overflow },
      };
    }),
    route: defaultRoute(deck),
    routes: deck.meta.routes.map(rt => ({ name: rt.name, stops: rt.stops.map(s => s.id) })),
  };
}
