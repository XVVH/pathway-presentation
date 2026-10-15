// The markdown-it instance Pathway parses with: CommonMark plus tables, raw
// HTML recognised (so the checker can flag it), [[wiki links]] to stops, and
// speaker notes in Pandoc's fenced-div form (::: notes ... :::).

import MarkdownIt from "markdown-it";
import type { MarkdownIt as Md, StateBlock, StateInline, Token } from "markdown-it";
import type { Run } from "./model.ts";

function wikilink(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
  const end = src.indexOf("]]", start + 2);
  if (end < 0) return false;
  const inner = src.slice(start + 2, end);
  if (!inner.trim() || inner.includes("\n") || inner.includes("[")) return false;
  if (!silent) {
    const bar = inner.indexOf("|");
    const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const label = bar < 0 ? null : inner.slice(bar + 1).trim() || null;
    const token = state.push("wikilink", "a", 0);
    token.content = inner;
    token.meta = { target, label, pos: start };
  }
  state.pos = end + 2;
  return true;
}

const NOTES_OPEN = /^(:{3,})[ \t]*(?:notes|\{[ \t]*\.notes[ \t]*\})[ \t]*:*[ \t]*$/;
const FENCE_CLOSE = /^:{3,}[ \t]*$/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;

/**
 * Speaker notes: `::: notes` (or `::: {.notes}`) up to a line of `:::`. The
 * notes are Markdown. A heading always ends them, closed or not, because a
 * heading is the next stop: forgetting the `:::` can't swallow the deck.
 */
function notesBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const open = NOTES_OPEN.exec(lineText(startLine));
  if (!open) return false;
  if (silent) return true;
  let next = startLine + 1, closed = false, code: string | null = null;
  for (; next < endLine; next++) {
    const text = lineText(next);
    if (text && state.sCount[next] < state.blkIndent) break;
    if (state.sCount[next] - state.blkIndent >= 4) continue;
    // Inside a code block, nothing ends the notes: a "# comment" is code.
    const fence = /^(`{3,}|~{3,})/.exec(text);
    if (code) {
      if (fence && fence[1][0] === code[0] && fence[1].length >= code.length && /^(`{3,}|~{3,})[ \t]*$/.test(text)) code = null;
      continue;
    }
    if (fence) { code = fence[1]; continue; }
    if (FENCE_CLOSE.test(text)) { closed = true; break; }
    if (HEADING.test(text)) break;
  }
  const oldParent = state.parentType, oldMax = state.lineMax;
  state.parentType = "blockquote";
  state.lineMax = next;
  const openToken = state.push("notes_open", "div", 1);
  openToken.block = true;
  openToken.markup = open[1];
  openToken.map = [startLine, closed ? next + 1 : next];
  openToken.meta = { closed };
  state.md.block.tokenize(state, startLine + 1, next);
  const closeToken = state.push("notes_close", "div", -1);
  closeToken.block = true;
  state.parentType = oldParent;
  state.lineMax = oldMax;
  state.line = closed ? next + 1 : next;
  return true;
}

export function createMarkdown(): Md {
  const md = new MarkdownIt({ html: true });
  md.inline.ruler.before("link", "wikilink", wikilink);
  md.block.ruler.before("fence", "notes", notesBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
  return md;
}

/** Splits a run of block tokens into what's shown and the notes blocks inside it. */
export function splitNotes(tokens: readonly Token[]): { shown: Token[]; notes: Token[][] } {
  const shown: Token[] = [], notes: Token[][] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.type === "notes_open") { if (depth++ === 0) notes.push([]); }
    if (depth) notes[notes.length - 1].push(t);
    else shown.push(t);
    if (t.type === "notes_close") depth--;
  }
  return { shown, notes };
}

/** Flattens inline tokens into styled runs of text, for word counts and wrapping. */
export function runsOf(children: readonly Token[] | null): Run[] {
  const runs: Run[] = [];
  let strong = 0;
  const push = (text: string, style: Run["style"]) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.style === style) last.text += text;
    else runs.push({ text, style });
  };
  for (const c of children ?? []) {
    switch (c.type) {
      case "text": push(c.content, strong ? "strong" : "normal"); break;
      case "code_inline": push(c.content, "code"); break;
      case "softbreak": case "hardbreak": push(" ", "normal"); break;
      case "strong_open": strong++; break;
      case "strong_close": strong--; break;
      case "wikilink": {
        const meta = c.meta as { target: string; label: string | null };
        push(meta.label ?? meta.target, strong ? "strong" : "normal");
        break;
      }
      default: break;
    }
  }
  return runs;
}

/**
 * A paragraph holding only an image, optionally followed by {attributes}, is a
 * figure. Returns the image token and the attribute text inside the braces.
 */
export function figureParts(inline: Token): { image: Token; attrs: string | null } | null {
  const kids = (inline.children ?? []).filter(c => !(c.type === "softbreak" || (c.type === "text" && !c.content.trim())));
  if (!kids.length || kids[0].type !== "image") return null;
  const after = kids.slice(1);
  if (after.length > 1) return null;
  if (!after.length) return { image: kids[0], attrs: null };
  const m = after[0].type === "text" ? /^\s*\{([^{}]*)\}\s*$/.exec(after[0].content) : null;
  return m ? { image: kids[0], attrs: m[1] } : null;
}

export function runsText(runs: readonly Run[]): string {
  return runs.map(r => r.text).join("").replace(/\s+/g, " ").trim();
}
