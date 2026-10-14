import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAttrs, splitTrailingAttrs } from "../src/attrs.ts";
import { parseDeck } from "../src/parse.ts";

const codes = (src: string) => parseDeck(src, "deck.md").diagnostics.map(d => d.code);

test("attributes: ids, classes, values and flags", () => {
  assert.deepEqual(parseAttrs('#intake .detour density=technical title="Two words" loop'), {
    id: "intake", classes: ["detour"], kv: { density: "technical", title: "Two words", loop: true }, errors: [],
  });
  assert.equal(parseAttrs("#").errors.length, 1);
  assert.equal(parseAttrs(".").errors.length, 1);
  assert.equal(parseAttrs("#a #b").errors.length, 1);
  assert.equal(parseAttrs("key=").errors.length, 1);
  assert.equal(parseAttrs('k="never closes').errors.length, 1);
  assert.equal(parseAttrs("#-bad").errors.length, 1);
});

test("attributes: split from the end of a heading, unless escaped", () => {
  assert.deepEqual(splitTrailingAttrs("Intake {#intake .detour}"), { text: "Intake", attrs: "#intake .detour" });
  assert.deepEqual(splitTrailingAttrs("No attributes"), { text: "No attributes", attrs: null });
  assert.deepEqual(splitTrailingAttrs("Literal \\{braces}"), { text: "Literal {braces}", attrs: null });
});

const DECK = `---
title: Pipelines
skin: boardroom
density: technical
routes:
  exec: [intake, fix]
  long:
    - intake
    - triage
---

# Why pipelines stall
Every team hits the same walls.

## Intake {#intake}
- **Triage:** requests pile up.
- **Handoff:** work changes hands.
  - a nested point

### Triage is a queue {.detour density=talk}
See [[intake]] and
[[fix|the fix]].

\`\`\`md
# not a stop
## nor this
\`\`\`

## The fix {#fix}
![Funnel](media/funnel.svg){.wide}

![Clip](media/clip.mp4){loop}
`;

test("stops: one per heading, in a tree, with ids, levels and depth", () => {
  const deck = parseDeck(DECK, "deck.md");
  assert.deepEqual(deck.diagnostics, []);
  assert.deepEqual(deck.stops.map(s => [s.id, s.level, s.depth, s.parent]), [
    ["why-pipelines-stall", 1, 0, null],
    ["intake", 2, 1, "why-pipelines-stall"],
    ["triage-is-a-queue", 3, 2, "intake"],
    ["fix", 2, 1, "why-pipelines-stall"],
  ]);
  assert.equal(deck.root?.id, "why-pipelines-stall");
  assert.deepEqual(deck.root?.children, ["intake", "fix"]);
  const triage = deck.byId.get("triage-is-a-queue")!;
  assert.equal(triage.detour, true);
  assert.equal(triage.density, "talk");
  assert.equal(triage.line, 20, "line numbers count the frontmatter");
});

test("frontmatter: skin, density and routes with their lines", () => {
  const { meta } = parseDeck(DECK, "deck.md");
  assert.equal(meta.skin, "boardroom");
  assert.equal(meta.density, "technical");
  assert.equal(meta.title, "Pipelines");
  assert.deepEqual(meta.routes.map(r => [r.name, r.line, r.stops.map(s => `${s.id}@${s.line}`)]), [
    ["exec", 6, ["intake@6", "fix@6"]],
    ["long", 7, ["intake@8", "triage@9"]],
  ]);
});

test("content: lists with lead-ins and nesting, links with lines, code, media", () => {
  const deck = parseDeck(DECK, "deck.md");
  const intake = deck.byId.get("intake")!;
  const list = intake.blocks[0];
  assert.equal(list.kind, "list");
  if (list.kind !== "list") return;
  assert.deepEqual(list.items.map(i => [i.leadIn, i.rest, i.depth]), [
    ["Triage", "requests pile up.", 0],
    ["Handoff", "work changes hands.", 0],
    [null, "a nested point", 1],
  ]);
  const triage = deck.byId.get("triage-is-a-queue")!;
  assert.deepEqual(triage.links.map(l => [l.target, l.label, l.line]), [["intake", null, 21], ["fix", "the fix", 22]]);
  assert.equal(triage.blocks.filter(b => b.kind === "code").length, 1);
  const fix = deck.byId.get("fix")!;
  assert.deepEqual(fix.media.map(m => [m.src, m.kind, m.classes, m.attrs, m.inline]), [
    ["media/funnel.svg", "image", ["wide"], {}, false],
    ["media/clip.mp4", "video", [], { loop: true }, false],
  ]);
});

test("words count body text only", () => {
  const deck = parseDeck("# T\n\n## S\nOne two three.\n\n- four five\n\n```\nnot counted\n```\n", "d.md");
  assert.equal(deck.byId.get("s")!.words, 5);
});

test("structure problems", () => {
  assert.deepEqual(codes("Intro text\n\n# Title\n\n## A\nx\n"), ["content-before-title"]);
  assert.deepEqual(codes("# One\n\n## A\nx\n\n# Two\n"), ["multiple-titles"]);
  assert.deepEqual(codes("## Not a title\nx\n"), ["no-title"]);
  assert.deepEqual(codes("# T\n"), ["no-stops"]);
  assert.deepEqual(codes("# T {.detour}\n\n## A\nx\n"), ["root-detour"]);
  assert.deepEqual(codes("# T\n\n## {#x}\nbody\n"), ["empty-title"]);
  assert.deepEqual(codes("# T\n\n## A\n> ## quoted heading\n"), ["nested-heading"]);
});

test("heading skips are errors with a fix that sets the right level", () => {
  const deck = parseDeck("# T\n\n#### Too deep {#deep}\nx\n", "d.md");
  const d = deck.diagnostics.find(x => x.code === "heading-skip")!;
  assert.equal(d.line, 3);
  assert.deepEqual(d.fix?.edits, [{ file: "d.md", startLine: 3, endLine: 4, newText: "## Too deep {#deep}" }]);
  assert.equal(deck.byId.get("deep")!.depth, 1, "treated as one level down for the rest of the checks");
});

test("duplicate ids are errors, renamed so checking can continue", () => {
  const deck = parseDeck("# T\n\n## Intro\nx\n\n## Intro {.detour}\ny\n", "d.md");
  const d = deck.diagnostics.find(x => x.code === "duplicate-id")!;
  assert.equal(d.line, 6);
  assert.equal(d.fix?.edits?.[0].newText, "## Intro {#intro-2 .detour}");
  assert.deepEqual(deck.stops.map(s => s.id), ["t", "intro", "intro-2"]);
  assert.deepEqual(deck.root?.children, ["intro", "intro-2"]);
});

test("attribute problems on stops and media", () => {
  assert.deepEqual(codes("# T\n\n## A {#a #b}\nx\n"), ["bad-attribute"]);
  const unknown = parseDeck("# T\n\n## A {.detuor}\nx\n", "d.md").diagnostics[0];
  assert.equal(unknown.code, "unknown-attribute");
  assert.match(unknown.message, /Did you mean '\.detour'\?/);
  assert.deepEqual(codes("# T\n\n## A {density=dense}\nx\n"), ["unknown-density"]);
  assert.deepEqual(codes("# T\n\n## A\n![x](a.png){.huge}\n"), ["unknown-attribute"]);
});

test("raw HTML and images inside text are flagged", () => {
  assert.deepEqual(codes("# T\n\n## A\n<div>hi</div>\n"), ["raw-html"]);
  assert.deepEqual(codes("# T\n\n## A\nText with <b>bold</b>.\n"), ["raw-html"]);
  assert.deepEqual(codes("# T\n\n## A\nSee ![x](a.png) here.\n"), ["inline-media"]);
});

test("frontmatter problems", () => {
  assert.deepEqual(codes("---\ntitle: x\n\n# T\n"), ["frontmatter-unclosed", "no-stops"]);
  const yaml = parseDeck("---\ntitle: [unclosed\n---\n\n# T\n\n## A\nx\n", "d.md").diagnostics[0];
  assert.equal(yaml.code, "frontmatter-yaml");
  assert.ok(yaml.line >= 2);
  const key = parseDeck("---\nrotues:\n  a: [x]\n---\n\n# T\n\n## A\nx\n", "d.md").diagnostics[0];
  assert.equal(key.code, "unknown-frontmatter-key");
  assert.equal(key.line, 2);
  assert.match(key.message, /Did you mean 'routes'\?/);
  assert.deepEqual(codes("---\nroutes: [a, b]\n---\n\n# T\n\n## A\nx\n"), ["route-format"]);
  assert.deepEqual(codes("---\nskin: neon\n---\n\n# T\n\n## A\nx\n"), ["unknown-skin"]);
});
