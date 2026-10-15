import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDeck } from "../src/check.ts";
import { compileDeck } from "../src/compile.ts";
import { applyEdits, safeEdits } from "../src/fix.ts";
import { renderBody } from "../src/html.ts";
import { planInlineNotes } from "../src/inline-notes.ts";
import { memoryIo } from "../src/io.ts";
import { parseDeck } from "../src/parse.ts";

const io = (deck: string, notes?: string) => memoryIo({ "talk/deck.md": deck, ...(notes === undefined ? {} : { "talk/deck.notes.md": notes }) });
const check = (deck: string, notes?: string) => checkDeck("talk/deck.md", io(deck, notes));
const codes = (deck: string, notes?: string) => check(deck, notes).diagnostics.map(d => d.code);
const notesOf = (deck: string, notes?: string) => compileDeck(check(deck, notes), io(deck, notes), { notes: true }).payload.notes!;

test("inline notes belong to their stop and never reach its card", () => {
  const src = "# T\n\n## A\nOn the card.\n\n::: notes\nSaid aloud, **not** shown.\n\nSecond paragraph.\n:::\n\nAlso on the card.\n";
  const deck = parseDeck(src, "d.md");
  const a = deck.byId.get("a")!;
  assert.deepEqual(a.notes, [{ line: 6, endLine: 10, closed: true, words: 6 }]);
  assert.deepEqual(a.blocks.map(b => b.kind), ["paragraph", "paragraph"]);
  assert.equal(a.words, 7, "notes don't count toward what the card holds");
  assert.equal(renderBody(src.split("\n").slice(3).join("\n"), { titles: new Map() }), "<p>On the card.</p>\n<p>Also on the card.</p>");
});

test("::: {.notes} works too, and lots of notes never make a stop crowded", () => {
  const long = Array.from({ length: 300 }, () => "word").join(" ");
  const src = `# T\n\n## A\nShort.\n\n::: {.notes}\n${long}\n:::\n`;
  assert.equal(parseDeck(src, "d.md").byId.get("a")!.notes[0].words, 300);
  assert.deepEqual(codes(src), []);
});

test("a heading always ends notes, so a missing ::: can't swallow the deck", () => {
  const src = "# T\n\n## A\nx\n\n::: notes\nForgot to close.\n\n## B\ny\n";
  const deck = parseDeck(src, "d.md");
  assert.deepEqual(deck.stops.map(s => s.id), ["t", "a", "b"]);
  assert.deepEqual(deck.byId.get("a")!.notes, [{ line: 6, endLine: 7, closed: false, words: 3 }]);
  const d = deck.diagnostics.find(x => x.code === "notes-unclosed")!;
  assert.equal(d.fix?.safe, true);
  const fixed = applyEdits(src, safeEdits(deck.diagnostics).get("d.md")!).text;
  assert.equal(fixed, "# T\n\n## A\nx\n\n::: notes\nForgot to close.\n:::\n\n## B\ny\n");
  assert.deepEqual(parseDeck(fixed, "d.md").diagnostics, []);
});

test("a # line inside code in the notes is code, not a heading", () => {
  const src = "# T\n\n## A\nx\n\n::: notes\n```sh\n# not a stop\n```\n:::\n\n## B\ny\n";
  const deck = parseDeck(src, "d.md");
  assert.deepEqual(deck.stops.map(s => s.id), ["t", "a", "b"]);
  assert.equal(deck.byId.get("a")!.notes[0].closed, true);
});

test("notes inside a list item are still notes", () => {
  const deck = parseDeck("# T\n\n## A\n- Point\n\n  ::: notes\n  Say more.\n  :::\n- Next point\n", "d.md");
  const a = deck.byId.get("a")!;
  assert.equal(a.notes.length, 1);
  const list = a.blocks[0];
  assert.ok(list.kind === "list" && list.items.every(i => !i.text.includes("Say more")));
});

test("compile: notes from the deck come first, then any from a notes file", () => {
  const deck = "# T\n\n## A\nx\n\n::: notes\nIn the deck.\n:::\n\n## B\ny\n";
  const notes = notesOf(deck, "## A\nIn the file.\n\n## B\nOnly in the file.\n");
  assert.equal(notes.a, "<p>In the deck.</p>\n<p>In the file.</p>");
  assert.equal(notes.b, "<p>Only in the file.</p>");
  assert.deepEqual(codes(deck, "## A\nIn the file.\n"), ["notes-duplicate"], "notes in both places are flagged");
});

test("check: inline notes count as notes; a title shared by two stops attaches to neither", () => {
  assert.equal(check("# T\n\n## A\nx\n\n::: notes\nHi.\n:::\n").summary.withNotes, 1);
  assert.equal(check("# T\n\n## A\nx\n").summary.withNotes, null);
  const deck = "# T\n\n## Intake\nx\n\n## Fix {#fix}\ny\n\n### Intake {#intake-2}\nz\n";
  const r = check(deck, "## Intake\nWhich one?\n\n## Intake {#intake-2}\nThis one.\n");
  const d = r.diagnostics.find(x => x.code === "notes-ambiguous")!;
  assert.match(d.message, /2 stops with that title \(lines 3, 9\).*\{#intake\} or \{#intake-2\}/);
  assert.deepEqual(Object.keys(notesOf(deck, "## Intake\nWhich one?\n\n## Intake {#intake-2}\nThis one.\n")), ["intake-2"]);
});

test("inline-notes: moves each section to the end of its stop and leaves strays", () => {
  const deck = "# T\nLead.\n\n## A\nOne.\n\n### A1\nDeeper.\n\n## B\nTwo.\n";
  const notes = "Preamble.\n\n## A\nFor A.\n\n## Nowhere\nStray.\n\n## B {#b}\n\nFor B.\n\n\n## T\nOpening.\n";
  const plan = planInlineNotes(check(deck, notes), io(deck, notes))!;
  assert.equal(plan.deck, "# T\nLead.\n\n::: notes\nOpening.\n:::\n\n## A\nOne.\n\n::: notes\nFor A.\n:::\n\n### A1\nDeeper.\n\n## B\nTwo.\n\n::: notes\nFor B.\n:::\n");
  assert.equal(plan.rest, "Preamble.\n\n## Nowhere\nStray.\n");
  assert.deepEqual(plan.kept.map(k => k.title), ["Nowhere"]);
  // The moved notes are the same notes the presenter showed before.
  const before = notesOf(deck, notes);
  const after = notesOf(plan.deck, plan.rest!);
  assert.deepEqual(after, before);
});
