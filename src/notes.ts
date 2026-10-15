// Speaker notes live beside the deck (talk.md → talk.notes.md), one section per
// stop. A section matches its stop by the same title, or by an explicit {#id}.

import { parseAttrs, splitTrailingAttrs } from "./attrs.ts";
import { createMarkdown, runsOf, runsText } from "./markdown.ts";
import type { Diagnostic, Notes, NotesSection } from "./model.ts";
import { countWords, slugify } from "./text.ts";

const md = createMarkdown();

export function defaultNotesPath(deckPath: string): string {
  return /\.md$/i.test(deckPath) ? deckPath.replace(/\.md$/i, ".notes.md") : `${deckPath}.notes.md`;
}

export function parseNotes(source: string, file: string): Notes {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const tokens = md.parse(text, {});
  const lines = text.split("\n").length;
  const diagnostics: Diagnostic[] = [];
  const sections: NotesSection[] = [];
  let preamble = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open" && t.level === 0) {
      const inline = tokens[i + 1];
      const split = splitTrailingAttrs(inline.content);
      const title = runsText(runsOf(md.parseInline(split.text, {})[0]?.children ?? null));
      const attrs = parseAttrs(split.attrs ?? "");
      const line = (t.map?.[0] ?? 0) + 1;
      for (const e of attrs.errors) diagnostics.push({ code: "bad-attribute", severity: "error", file, line, message: `In this heading's {…}: ${e}.` });
      if (sections.length) sections[sections.length - 1].endLine = line - 1;
      sections.push({ id: attrs.id ?? slugify(title), explicitId: !!attrs.id, matched: false, title, line, endLine: lines, words: 0 });
      continue;
    }
    if (t.type === "inline") {
      if (sections.length) sections[sections.length - 1].words += countWords(runsText(runsOf(t.children)));
      else if (!preamble && t.content.trim()) {
        preamble = true;
        diagnostics.push({ code: "notes-preamble", severity: "warning", file, line: (t.map?.[0] ?? 0) + 1, message: "Notes before the first heading don't belong to any stop. Put them under a heading that matches a stop." });
      }
    }
  }
  return { file, sections, diagnostics };
}
