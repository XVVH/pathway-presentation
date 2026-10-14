// Applies line edits from diagnostics. Edits use the original line numbers, so
// each file's edits are applied from the bottom up; overlapping edits are skipped.

import type { Diagnostic, Edit } from "./model.ts";

export function applyEdits(text: string, edits: readonly Edit[]): { text: string; applied: number } {
  const lines = text.split("\n");
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine || b.endLine - a.endLine);
  let applied = 0;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.endLine > floor) continue;
    lines.splice(e.startLine - 1, e.endLine - e.startLine, ...(e.newText === "" ? [] : e.newText.split("\n")));
    floor = e.startLine;
    applied++;
  }
  return { text: lines.join("\n"), applied };
}

/** The edits of every safe fix, grouped by file. */
export function safeEdits(diagnostics: readonly Diagnostic[]): Map<string, Edit[]> {
  const byFile = new Map<string, Edit[]>();
  for (const d of diagnostics) {
    if (!d.fix?.safe || !d.fix.edits) continue;
    for (const e of d.fix.edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  }
  return byFile;
}
