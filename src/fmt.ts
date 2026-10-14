// `pathway fmt`: tidies a deck's layout without changing what it says. A blank
// line before each heading (a stop's body may start right under it), one space
// after the #s, no runs of blank lines, no trailing spaces, one newline at the end. Frontmatter, code and hard line
// breaks are left exactly as written.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function formatDeck(source: string): string {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  // Frontmatter: copied as is.
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, k) => k > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (close > 0) { out.push(...lines.slice(0, close + 1)); i = close + 1; }
  }

  let fence: { char: string; len: number } | null = null;
  const lastIsBlank = () => out.length === 0 || out[out.length - 1] === "";
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      out.push(line);
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) fence = null;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      out.push(line.replace(/[ \t]+$/, ""));
      continue;
    }
    if (!line.trim()) {
      // Runs of blank lines become one, except inside indented code.
      const next = lines.slice(i + 1).find(l => l.trim());
      if (lastIsBlank() && !(next !== undefined && /^( {4}|\t)/.test(next))) continue;
      out.push("");
      continue;
    }
    // Indentation is kept: a heading indented under a list item belongs to it.
    const heading = /^( {0,3})(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (heading) {
      const [, indent, hashes] = heading;
      const text = (heading[3] ?? "").replace(/[ \t]+#+$/, "").replace(/^#+$/, "");
      if (!lastIsBlank()) out.push("");
      out.push(`${indent}${hashes}${text ? ` ${text}` : ""}`);
      continue;
    }
    // Two or more trailing spaces before more text are a hard line break: keep them.
    const hardBreak = /\S {2,}$/.test(line) && i + 1 < lines.length && lines[i + 1].trim() !== "";
    out.push(hardBreak ? line : line.replace(/[ \t]+$/, ""));
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return `${out.join("\n")}\n`;
}
