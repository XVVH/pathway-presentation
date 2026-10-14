// YAML frontmatter between --- lines at the top of a deck: title, skin,
// density, named routes, and where the notes live.

import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { DeckMeta, Diagnostic, NamedRoute } from "./model.ts";
import { closest } from "./text.ts";
import { DENSITIES, DEFAULT_SKIN, SKINS, type Density } from "./typography.ts";

const KNOWN_KEYS = ["title", "subtitle", "author", "date", "description", "skin", "density", "routes", "notes"];

export interface Frontmatter {
  /** Number of lines the frontmatter occupies, including both --- lines. 0 if none. */
  lineCount: number;
  meta: DeckMeta;
}

export function readFrontmatter(lines: readonly string[], file: string, diagnostics: Diagnostic[]): Frontmatter {
  const meta: DeckMeta = { skin: DEFAULT_SKIN, density: "talk", routes: [], raw: {} };
  if (lines[0]?.trim() !== "---") return { lineCount: 0, meta };
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) { close = i; break; }
  if (close < 0) {
    diagnostics.push({ code: "frontmatter-unclosed", severity: "error", file, line: 1, message: "The frontmatter starts with --- but never closes. Add a --- line after it." });
    return { lineCount: 0, meta };
  }
  const yaml = lines.slice(1, close).join("\n");
  const lineOf = (offset: number) => yaml.slice(0, offset).split("\n").length + 1;
  const doc = parseDocument(yaml, { prettyErrors: true });
  for (const err of doc.errors) {
    diagnostics.push({ code: "frontmatter-yaml", severity: "error", file, line: (err.linePos?.[0].line ?? 1) + 1, message: `The frontmatter isn't valid YAML: ${err.message.split("\n")[0]}` });
  }
  if (doc.errors.length) return { lineCount: close + 1, meta };

  const data = doc.toJS() ?? {};
  if (typeof data !== "object" || Array.isArray(data)) {
    diagnostics.push({ code: "frontmatter-yaml", severity: "error", file, line: 2, message: "The frontmatter should be a list of `key: value` lines." });
    return { lineCount: close + 1, meta };
  }
  meta.raw = data;
  const keyLine = (key: string) => {
    const node = doc.contents;
    if (isMap(node)) for (const item of node.items) if (isScalar(item.key) && item.key.value === key && item.key.range) return lineOf(item.key.range[0]);
    return 2;
  };

  for (const key of Object.keys(data)) {
    if (KNOWN_KEYS.includes(key)) continue;
    const guess = closest(key, KNOWN_KEYS);
    diagnostics.push({
      code: "unknown-frontmatter-key", severity: "warning", file, line: keyLine(key),
      message: `Unknown frontmatter key '${key}'.${guess ? ` Did you mean '${guess}'?` : ` Known keys: ${KNOWN_KEYS.join(", ")}.`}`,
    });
  }
  if (typeof data.title === "string") meta.title = data.title;
  if (data.skin !== undefined) {
    if (typeof data.skin === "string" && SKINS[data.skin]) meta.skin = data.skin;
    else diagnostics.push({ code: "unknown-skin", severity: "warning", file, line: keyLine("skin"), message: `Unknown skin '${String(data.skin)}'. Built-in skins: ${Object.keys(SKINS).join(", ")}. Using ${DEFAULT_SKIN}.` });
  }
  if (data.density !== undefined) {
    if (DENSITIES.includes(data.density as Density)) meta.density = data.density as Density;
    else diagnostics.push({ code: "unknown-density", severity: "error", file, line: keyLine("density"), message: `Unknown density '${String(data.density)}'. Use one of: ${DENSITIES.join(", ")}.` });
  }
  if (data.notes !== undefined) {
    if (typeof data.notes === "string" && data.notes.trim()) meta.notes = data.notes.trim();
    else diagnostics.push({ code: "frontmatter-type", severity: "error", file, line: keyLine("notes"), message: "`notes` should be the path of the speaker notes file." });
  }
  if (data.routes !== undefined) meta.routes = readRoutes(doc.get("routes", true), lineOf, keyLine("routes"), file, diagnostics);
  return { lineCount: close + 1, meta };
}

function readRoutes(node: unknown, lineOf: (o: number) => number, line: number, file: string, diagnostics: Diagnostic[]): NamedRoute[] {
  const routes: NamedRoute[] = [];
  const bad = (at: number, message: string) => diagnostics.push({ code: "route-format", severity: "error", file, line: at, message });
  if (!isMap(node)) { bad(line, "`routes` should map route names to lists of stop ids, like `exec: [intake, fix]`."); return routes; }
  for (const item of node.items) {
    const name = isScalar(item.key) ? String(item.key.value) : "";
    const nameLine = isScalar(item.key) && item.key.range ? lineOf(item.key.range[0]) : line;
    if (!isSeq(item.value)) { bad(nameLine, `Route '${name}' should be a list of stop ids, like \`${name}: [intake, fix]\`.`); continue; }
    const stops: NamedRoute["stops"] = [];
    for (const s of item.value.items) {
      const at = isScalar(s) && s.range ? lineOf(s.range[0]) : nameLine;
      if (isScalar(s) && (typeof s.value === "string" || typeof s.value === "number")) stops.push({ id: String(s.value), line: at });
      else bad(at, `Route '${name}' should list stop ids as plain words.`);
    }
    routes.push({ name, line: nameLine, stops });
  }
  return routes;
}
