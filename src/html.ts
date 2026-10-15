// Markdown to card HTML. Raw HTML is dropped (the checker says so), figures are
// pulled out of the text so the card can place them, and [[links]] become links
// the engine can follow.

import type { Token } from "markdown-it";
import { createMarkdown, figureParts, splitNotes } from "./markdown.ts";

export interface RenderEnv {
  /** Stop titles by id, for [[links]] without a label. */
  titles: ReadonlyMap<string, string>;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const md = createMarkdown();
const rules = md.renderer.rules;
rules.html_block = () => "";
rules.html_inline = () => "";
// Images inside text aren't shown; a figure is an image on a line of its own.
rules.image = () => "";
rules.wikilink = (tokens, i, _o, env) => {
  const { target, label } = tokens[i].meta as { target: string; label: string | null };
  const title = (env as Partial<RenderEnv> | undefined)?.titles?.get(target);
  const text = escapeHtml(label ?? title ?? target);
  return title === undefined ? `<span class="stop-link broken">${text}</span>` : `<a class="stop-link" href="#${encodeURIComponent(target)}" data-stop="${escapeHtml(target)}">${text}</a>`;
};
const linkOpen = rules.link_open ?? ((tokens, i, o, _env, self) => self.renderToken(tokens, i, o));
rules.link_open = (tokens, i, o, env, self) => {
  const href = String(tokens[i].attrGet("href") ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { tokens[i].attrSet("target", "_blank"); tokens[i].attrSet("rel", "noopener noreferrer"); }
  return linkOpen(tokens, i, o, env, self);
};
// Headings tucked inside lists or quotes aren't stops; show them as bold lines.
rules.heading_open = () => "<p><strong>";
rules.heading_close = () => "</strong></p>\n";
rules.fence = (tokens, i) => {
  const t = tokens[i], lang = t.info.trim().split(/\s+/)[0] ?? "";
  let code = escapeHtml(t.content.replace(/\n$/, ""));
  if (/^(md|markdown)$/i.test(lang)) code = code.replace(/^(#{1,6} .*)$/gm, '<span class="kw">$1</span>');
  return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${code}</code></pre>\n`;
};
rules.code_block = (tokens, i) => `<pre><code>${escapeHtml(tokens[i].content.replace(/\n$/, ""))}</code></pre>\n`;

/** Renders Markdown as card HTML, leaving out figures and speaker notes. */
export function renderBody(source: string, { titles }: RenderEnv): string {
  const env: Record<string, unknown> = { titles };
  const tokens = splitNotes(md.parse(source, env)).shown;
  const kept: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "paragraph_open" && t.level === 0 && tokens[i + 1]?.type === "inline" && figureParts(tokens[i + 1])) { i += 2; continue; }
    kept.push(t);
  }
  return md.renderer.render(kept, md.options, env).trim();
}
