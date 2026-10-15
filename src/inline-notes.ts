// `pathway inline-notes`: moves a separate notes file into the deck, each
// section into a `::: notes` block at the end of its stop, so notes move with
// their stop from then on. Sections that match no stop stay where they are.

import type { CheckResult } from "./check.ts";
import { applyEdits } from "./fix.ts";
import type { Io } from "./io.ts";
import type { Edit } from "./model.ts";

export interface InlinePlan {
  /** The deck with the notes moved in. */
  deck: string;
  /** What's left of the notes file, or null when nothing is: the file can go. */
  rest: string | null;
  moved: { title: string; stop: string; line: number }[];
  kept: { title: string; line: number; reason: string }[];
}

const trimBlank = (lines: string[]) => {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

export function planInlineNotes(result: CheckResult, io: Io): InlinePlan | null {
  const { deck, notes } = result;
  if (!notes) return null;
  const text = io.read(notes.file);
  if (text === null) return null;
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const moved: InlinePlan["moved"] = [], kept: InlinePlan["kept"] = [];
  const bodies = new Map<string, string[][]>();
  const keep = new Set<number>();

  for (const s of notes.sections) {
    const body = trimBlank(lines.slice(s.line, s.endLine));
    if (!s.matched) {
      kept.push({ title: s.title, line: s.line, reason: "it matches no stop" });
      keep.add(s.line);
    } else if (body.some(l => /^ {0,3}:{3,}/.test(l))) {
      kept.push({ title: s.title, line: s.line, reason: "it contains a ':::' line, which would end the notes early" });
      keep.add(s.line);
    } else {
      if (body.length) bodies.set(s.id, [...(bodies.get(s.id) ?? []), body]);
      moved.push({ title: s.title, stop: s.id, line: s.line });
    }
  }

  // Each stop's notes go at the end of its own text, before its first child.
  const edits: Edit[] = [];
  for (const [id, parts] of bodies) {
    const stop = deck.byId.get(id)!;
    const block = ["", "::: notes", ...parts.flatMap((p, i) => (i ? ["", ...p] : p)), ":::"];
    edits.push({ file: deck.file, startLine: stop.endLine + 1, endLine: stop.endLine + 1, newText: block.join("\n") });
  }
  const source = deck.lines.join("\n");
  const newDeck = applyEdits(source, edits).text;

  // What stays in the notes file: text before the first heading, and the kept sections.
  const first = notes.sections[0]?.line ?? lines.length + 1;
  const restLines = [...trimBlank(lines.slice(0, first - 1))];
  for (const s of notes.sections) {
    if (!keep.has(s.line)) continue;
    if (restLines.length) restLines.push("");
    restLines.push(...trimBlank(lines.slice(s.line - 1, s.endLine)));
  }
  return { deck: newDeck, rest: restLines.some(l => l.trim()) ? `${restLines.join("\n")}\n` : null, moved, kept };
}
