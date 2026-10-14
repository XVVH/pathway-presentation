// Turns a deck's Markdown into its map: stops (one per heading), their tree,
// their content blocks, links and media. Positions are kept for every piece so
// the checker can point at the exact line.

import type { Token } from "markdown-it";
import { parseAttrs, splitTrailingAttrs } from "./attrs.ts";
import { readFrontmatter } from "./frontmatter.ts";
import { createMarkdown, figureParts, runsOf, runsText } from "./markdown.ts";
import { mediaKind, isRemote } from "./media.ts";
import type { Block, Deck, Diagnostic, ListItem, MediaRef, Stop, WikiLink } from "./model.ts";
import { closest, countWords, slugify } from "./text.ts";
import { DENSITIES, type Density } from "./typography.ts";

const md = createMarkdown();
const STOP_CLASSES = ["detour"];
const STOP_KEYS = ["density"];
const MEDIA_CLASSES = ["wide"];
const MEDIA_KEYS = ["loop"];

/** Index just past the token that closes the one at `i`. */
function blockEnd(tokens: readonly Token[], i: number): number {
  if (tokens[i].nesting !== 1) return i + 1;
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    depth += tokens[j].nesting;
    if (depth === 0) return j + 1;
  }
  return tokens.length;
}

const lineOf = (t: Token) => (t.map ? t.map[0] + 1 : 1);
const endLineOf = (t: Token) => (t.map ? t.map[1] : lineOf(t));

export function parseDeck(source: string, file: string): Deck {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const diagnostics: Diagnostic[] = [];
  const diag = (d: Omit<Diagnostic, "file">) => diagnostics.push({ file, ...d });

  const fm = readFrontmatter(lines, file, diagnostics);
  // Blank the frontmatter rather than cutting it, so token line numbers match the file.
  const body = lines.map((l, i) => (i < fm.lineCount ? "" : l)).join("\n");
  const tokens = md.parse(body, {});

  const stops: Stop[] = [];
  let cur: Stop | null = null;
  // An unclosed frontmatter block is already an error; don't also report its lines as stray content.
  let preambleReported = diagnostics.some(d => d.code === "frontmatter-unclosed");

  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    if (t.type === "heading_open" && t.level === 0) {
      cur = startStop(t, tokens[i + 1], file, diag);
      stops.push(cur);
      i = blockEnd(tokens, i);
      continue;
    }
    const end = blockEnd(tokens, i);
    const slice = tokens.slice(i, end);
    if (!cur) {
      if (!preambleReported) {
        diag({ code: "content-before-title", severity: "warning", line: lineOf(t), message: "Content before the first heading isn't part of any stop and won't be shown. Move it under a heading." });
        preambleReported = true;
      }
    } else addBlock(cur, slice, file, diag);
    i = end;
  }

  // End lines never include trailing blank lines, so edits that remove a block
  // and edits that insert after it don't collide.
  const trim = (start: number, end: number) => { while (end > start && !lines[end - 1]?.trim()) end--; return end; };
  for (const s of stops) for (const b of s.blocks) b.endLine = trim(b.line, b.endLine);
  // A stop's body runs until the next heading.
  stops.forEach((s, k) => {
    let end = k + 1 < stops.length ? stops[k + 1].line - 1 : lines.length;
    while (end > s.line && !lines[end - 1]?.trim()) end--;
    s.endLine = end;
  });

  // Make ids unique before linking the tree, so parent and child references stay true.
  const byId = new Map<string, Stop>();
  for (const s of stops) {
    if (!byId.has(s.id)) { byId.set(s.id, s); continue; }
    const first = byId.get(s.id)!;
    let n = 2;
    while (byId.has(`${s.id}-${n}`)) n++;
    const suggestion = `${s.id}-${n}`;
    diag({
      code: "duplicate-id", severity: "error", line: s.line, stop: s.id,
      message: `Two stops have the id '${s.id}' (the other is on line ${first.line}). Give one an explicit id, like {#${suggestion}}.`,
      fix: { description: `Add {#${suggestion}} to this heading.`, safe: false, edits: [{ file, startLine: s.line, endLine: s.line + 1, newText: withId(lines[s.line - 1], suggestion) }] },
    });
    s.id = suggestion;
    byId.set(s.id, s);
  }
  const root = buildTree(stops, lines, file, diag);
  return { file, lines, meta: { ...fm.meta, title: fm.meta.title ?? root?.title }, stops, byId, root, diagnostics };
}

function withId(headingLine: string, id: string): string {
  const { text, attrs } = splitTrailingAttrs(headingLine);
  const rest = attrs ? attrs.replace(/(^|\s)#\S+/, "").trim() : "";
  return `${text} {#${id}${rest ? ` ${rest}` : ""}}`;
}

function startStop(open: Token, inline: Token, file: string, diag: (d: Omit<Diagnostic, "file">) => void): Stop {
  const line = lineOf(open);
  const level = Number(open.tag.slice(1));
  const split = splitTrailingAttrs(inline.content);
  const title = runsText(runsOf(md.parseInline(split.text, {})[0]?.children ?? null));
  const attrs = parseAttrs(split.attrs ?? "");
  for (const e of attrs.errors) diag({ code: "bad-attribute", severity: "error", line, message: `In this heading's {…}: ${e}.` });
  for (const c of attrs.classes) if (!STOP_CLASSES.includes(c)) {
    const guess = closest(c, STOP_CLASSES);
    diag({ code: "unknown-attribute", severity: "warning", line, message: `Unknown class '.${c}' on a stop.${guess ? ` Did you mean '.${guess}'?` : ` Known: ${STOP_CLASSES.map(x => `.${x}`).join(", ")}.`}` });
  }
  for (const k of Object.keys(attrs.kv)) if (!STOP_KEYS.includes(k)) {
    const guess = closest(k, STOP_KEYS);
    diag({ code: "unknown-attribute", severity: "warning", line, message: `Unknown attribute '${k}' on a stop.${guess ? ` Did you mean '${guess}'?` : ` Known: ${STOP_KEYS.join(", ")}.`}` });
  }
  let density: Density | null = null;
  if (attrs.kv.density !== undefined) {
    if (DENSITIES.includes(attrs.kv.density as Density)) density = attrs.kv.density as Density;
    else diag({ code: "unknown-density", severity: "error", line, message: `Unknown density '${String(attrs.kv.density)}'. Use one of: ${DENSITIES.join(", ")}.` });
  }
  if (!title) diag({ code: "empty-title", severity: "error", line, message: "This heading has no title. Every stop needs one; it's what the map shows." });
  let id = attrs.id ?? slugify(title);
  if (!id) {
    diag({ code: "no-id", severity: "error", line, message: "Can't make an id from this title. Add one, like {#overview}." });
    id = `stop-${line}`;
  }
  return {
    id, idExplicit: !!attrs.id, title, level, depth: 0, line, endLine: line,
    classes: attrs.classes, attrs: attrs.kv, detour: attrs.classes.includes("detour"), density,
    parent: null, children: [], blocks: [], links: [], media: [], words: 0,
  };
}

function addBlock(stop: Stop, slice: Token[], file: string, diag: (d: Omit<Diagnostic, "file">) => void) {
  const first = slice[0];
  const line = lineOf(first), endLine = endLineOf(first);
  const inlines = slice.filter(t => t.type === "inline");

  // Links, raw HTML and stray headings anywhere in the block.
  for (const inl of inlines) {
    for (const c of inl.children ?? []) if (c.type === "wikilink") stop.links.push(wikiPosition(inl, c));
    if (inl.children?.some(c => c.type === "html_inline")) diag({ code: "raw-html", severity: "warning", line: lineOf(inl), stop: stop.id, message: "Raw HTML isn't rendered. Use Markdown, so the stop works on the map, in the strip and in video." });
  }
  for (const t of slice) if (t.type === "heading_open") diag({ code: "nested-heading", severity: "warning", line: lineOf(t), stop: stop.id, message: "A heading inside a list or quote doesn't become a stop. Move it to the start of a line." });

  let block: Block | null = null;
  switch (first.type) {
    case "paragraph_open": {
      const inl = slice[1];
      const media = mediaParagraph(inl, stop, diag);
      if (media) block = { kind: "media", line, endLine, media };
      else {
        collectInlineMedia(inl, stop, diag);
        const runs = runsOf(inl.children);
        const text = runsText(runs);
        block = { kind: "paragraph", line, endLine, runs, text, words: countWords(text) };
      }
      break;
    }
    case "bullet_list_open":
    case "ordered_list_open": {
      const items: ListItem[] = [];
      const open: ListItem[] = [];
      let listDepth = -1;
      for (const t of slice) {
        if (t.type === "bullet_list_open" || t.type === "ordered_list_open") listDepth++;
        else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") listDepth--;
        else if (t.type === "list_item_open") {
          const item: ListItem = { line: lineOf(t), runs: [], text: "", words: 0, leadIn: null, rest: "", depth: listDepth };
          items.push(item); open.push(item);
        } else if (t.type === "list_item_close") open.pop();
        else if (t.type === "inline" && open.length) {
          const item = open[open.length - 1];
          if (item.runs.length) item.runs.push({ text: " ", style: "normal" });
          item.runs.push(...runsOf(t.children));
          collectInlineMedia(t, stop, diag);
        }
      }
      for (const item of items) {
        item.text = runsText(item.runs);
        item.words = countWords(item.text);
        const lead = item.runs[0]?.style === "strong" ? item.runs[0].text.trim() : "";
        const rest = runsText(item.runs.slice(1)).replace(/^[\s:–—-]+/, "");
        if (lead && rest) { item.leadIn = lead.replace(/[:.–—-]+$/, "").trim(); item.rest = rest; }
        else item.rest = item.text;
      }
      block = { kind: "list", line, endLine, ordered: first.type === "ordered_list_open", items };
      break;
    }
    case "fence":
    case "code_block": {
      const lines = first.content.replace(/\n$/, "").split("\n");
      block = { kind: "code", line, endLine, lang: first.info.trim().split(/\s+/)[0] ?? "", lines };
      break;
    }
    case "blockquote_open": {
      const runs = inlines.flatMap((t, k) => (k ? [{ text: " ", style: "normal" as const }, ...runsOf(t.children)] : runsOf(t.children)));
      const text = runsText(runs);
      for (const inl of inlines) collectInlineMedia(inl, stop, diag);
      block = { kind: "quote", line, endLine, runs, text, words: countWords(text), paragraphs: inlines.map(t => runsOf(t.children)) };
      break;
    }
    case "table_open": {
      const text = inlines.map(t => runsText(runsOf(t.children))).join(" ");
      block = { kind: "table", line, endLine, rows: slice.filter(t => t.type === "tr_open").length, text, words: countWords(text) };
      break;
    }
    case "html_block":
      diag({ code: "raw-html", severity: "warning", line, stop: stop.id, message: "Raw HTML isn't rendered. Use Markdown, so the stop works on the map, in the strip and in video." });
      block = { kind: "html", line, endLine };
      break;
    case "hr":
      block = { kind: "rule", line, endLine };
      break;
    default:
      break;
  }
  if (!block) return;
  stop.blocks.push(block);
  if (block.kind === "paragraph" || block.kind === "quote" || block.kind === "table") stop.words += block.words;
  if (block.kind === "list") stop.words += block.items.reduce((a, it) => a + it.words, 0);
}

function wikiPosition(inl: Token, c: Token): WikiLink {
  const meta = c.meta as { target: string; label: string | null; pos: number };
  const before = inl.content.slice(0, meta.pos);
  const nl = before.lastIndexOf("\n");
  return { target: meta.target, label: meta.label, line: lineOf(inl) + (before.match(/\n/g)?.length ?? 0), column: meta.pos - nl };
}

function mediaRef(img: Token, line: number, inline: boolean): MediaRef {
  let src = String(img.attrGet("src") ?? "");
  try { src = decodeURI(src); } catch { /* keep as written */ }
  return { src, alt: img.content, kind: mediaKind(src), classes: [], attrs: {}, line, remote: isRemote(src), inline };
}

/** A paragraph holding only an image (and optional {attributes}) is a figure. */
function mediaParagraph(inl: Token, stop: Stop, diag: (d: Omit<Diagnostic, "file">) => void): MediaRef | null {
  const parts = figureParts(inl);
  if (!parts) return null;
  const line = lineOf(inl);
  const ref = mediaRef(parts.image, line, false);
  if (parts.attrs !== null) {
    const attrs = parseAttrs(parts.attrs);
    for (const e of attrs.errors) diag({ code: "bad-attribute", severity: "error", line, stop: stop.id, message: `In this media's {…}: ${e}.` });
    for (const c of attrs.classes) if (!MEDIA_CLASSES.includes(c)) diag({ code: "unknown-attribute", severity: "warning", line, stop: stop.id, message: `Unknown class '.${c}' on media. Known: ${MEDIA_CLASSES.map(x => `.${x}`).join(", ")}.` });
    for (const k of Object.keys(attrs.kv)) if (!MEDIA_KEYS.includes(k)) diag({ code: "unknown-attribute", severity: "warning", line, stop: stop.id, message: `Unknown attribute '${k}' on media. Known: ${MEDIA_KEYS.join(", ")}.` });
    if (attrs.id) diag({ code: "unknown-attribute", severity: "warning", line, stop: stop.id, message: "Media doesn't take an id." });
    ref.classes = attrs.classes; ref.attrs = attrs.kv;
  }
  stop.media.push(ref);
  return ref;
}

function collectInlineMedia(inl: Token, stop: Stop, diag: (d: Omit<Diagnostic, "file">) => void) {
  for (const c of inl.children ?? []) {
    if (c.type !== "image") continue;
    const ref = mediaRef(c, lineOf(inl), true);
    stop.media.push(ref);
    diag({ code: "inline-media", severity: "warning", line: ref.line, stop: stop.id, message: `'${ref.src}' sits inside text, so it won't be shown as a figure. Put it on a line of its own.` });
  }
}

function buildTree(stops: Stop[], lines: readonly string[], file: string, diag: (d: Omit<Diagnostic, "file">) => void): Stop | null {
  let root: Stop | null = null;
  const level = new Map<Stop, number>();
  const stack: Stop[] = [];
  stops.forEach((s, k) => {
    let lv = s.level;
    if (lv === 1) {
      if (!root && k === 0) { root = s; level.set(s, 1); stack.push(s); return; }
      diag({ code: "multiple-titles", severity: "error", line: s.line, stop: s.id, message: "A deck has one # title. Make this a ## stop, or start a new deck." });
      lv = 2;
    }
    if (!root && k === 0) diag({ code: "no-title", severity: "error", line: s.line, stop: s.id, message: "A deck starts with a # title: the first stop, where the trail begins." });
    while (stack.length && level.get(stack[stack.length - 1])! >= lv) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const expected = parent ? level.get(parent)! + 1 : 2;
    if (lv > expected) {
      const fixed = "#".repeat(expected);
      diag({
        code: "heading-skip", severity: "error", line: s.line, stop: s.id,
        message: `This heading jumps from ${"#".repeat(expected - 1)} to ${"#".repeat(lv)}. A stop can only be one level below its parent, so use ${fixed}.`,
        fix: { description: `Change ${"#".repeat(s.level)} to ${fixed}.`, safe: false, edits: [{ file, startLine: s.line, endLine: s.line + 1, newText: lines[s.line - 1].replace(/^(\s{0,3})#+/, `$1${fixed}`) }] },
      });
      lv = expected;
    }
    level.set(s, lv);
    s.depth = parent ? parent.depth + 1 : 1;
    s.parent = parent ? parent.id : null;
    if (parent) parent.children.push(s.id);
    stack.push(s);
  });
  if (root) {
    const r: Stop = root;
    if (r.detour) diag({ code: "root-detour", severity: "error", line: r.line, stop: r.id, message: "The title stop is where the route starts, so it can't be a detour." });
    if (!stops.some(s => s.parent === r.id)) diag({ code: "no-stops", severity: "warning", line: r.line, stop: r.id, message: "The deck has a title but no ## stops yet." });
  }
  return root;
}
