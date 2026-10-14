// The markdown-it instance Pathway parses with: CommonMark plus tables, raw
// HTML recognised (so the checker can flag it), and [[wiki links]] to stops.

import MarkdownIt from "markdown-it";
import type { MarkdownIt as Md, StateInline, Token } from "markdown-it";
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

export function createMarkdown(): Md {
  const md = new MarkdownIt({ html: true });
  md.inline.ruler.before("link", "wikilink", wikilink);
  return md;
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
