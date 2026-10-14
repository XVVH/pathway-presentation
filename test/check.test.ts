import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkDeck } from "../src/check.ts";
import { applyEdits } from "../src/fix.ts";
import { memoryIo } from "../src/io.ts";
import { nodeIo } from "../src/io-node.ts";
import { defaultRoute } from "../src/routes.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58]);
const check = (deck: string, files: Record<string, string | Uint8Array> = {}, opts = {}) =>
  checkDeck("talk/deck.md", memoryIo({ "talk/deck.md": deck, ...files }), opts);
const codes = (deck: string, files = {}) => check(deck, files).diagnostics.map(d => d.code);
// Ordinary English, so word counts behave like real prose.
const PROSE = "the camera rides the trail itself easing in and out so every move between neighbouring stops feels like travelling a path".split(" ");
const words = (n: number) => Array.from({ length: n }, (_, i) => PROSE[i % PROSE.length]).join(" ");

test("the example deck is clean", () => {
  const r = checkDeck("examples/pathway/pathway.md", nodeIo);
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.summary, { errors: 0, warnings: 0, infos: 0, stops: 19, detours: 3, withNotes: 12 });
});

test("links: broken ones are errors; a matching title is a safe fix, a typo a proposal", () => {
  const r = check("# T\n\n## Intake {#intake}\nx\n\n## B\nSee [[Intake]], [[intak]] and [[nothing-like-it]].\n");
  const links = r.diagnostics.filter(d => d.code === "broken-link");
  assert.equal(links.length, 3);
  assert.deepEqual(links.map(d => [d.line, d.fix?.safe]), [[7, true], [7, false], [7, undefined]]);
  assert.equal(links[0].fix?.edits?.[0].newText, "See [[intake]], [[intak]] and [[nothing-like-it]].");
});

test("media: must exist, travel with the deck, and be a known kind", () => {
  const deck = (src: string) => `# T\n\n## A\n![x](${src})\n`;
  assert.deepEqual(codes(deck("media/a.png"), { "talk/media/a.png": PNG }), []);
  const missing = check(deck("media/funel.png"), { "talk/media/funnel.png": PNG }).diagnostics[0];
  assert.equal(missing.code, "missing-media");
  assert.match(missing.message, /Did you mean 'media\/funnel\.png'\?/);
  assert.deepEqual(codes(deck("https://example.com/a.png")), ["remote-media"]);
  assert.deepEqual(codes(deck("/abs/a.png"), { "/abs/a.png": PNG }), ["absolute-media-path"]);
  assert.deepEqual(codes(deck("../shared/a.png"), { "shared/a.png": PNG }), ["media-outside-deck"]);
  assert.deepEqual(codes(deck("media/a.pdf"), { "talk/media/a.pdf": "x" }), ["unsupported-media"]);
});

test("routes: every listed stop must exist", () => {
  const r = check("---\nroutes:\n  exec: [intake, fixx, intake]\n  empty: []\n---\n\n# T\n\n## Intake\nx\n\n## Fix\ny\n");
  assert.deepEqual(r.diagnostics.map(d => [d.code, d.line]), [["route-unknown-stop", 3], ["route-duplicate-stop", 3], ["route-empty", 4]]);
  assert.equal(r.diagnostics[0].fix?.edits?.[0].newText, "  exec: [intake, fix, intake]");
});

test("density: too much to read is a warning; too much to fit is an error", () => {
  assert.deepEqual(codes(`# T\n\n## A\n${words(35)}\n`), []);
  assert.deepEqual(codes(`# T\n\n## A\n${words(60)}\n`), ["stop-dense"]);
  assert.deepEqual(codes(`# T\n\n## A\n${words(200)}\n`), ["stop-overflow"]);
  assert.deepEqual(codes(`# T\n\n## A {density=technical}\n${words(60)}\n`), [], "technical density takes more");
  assert.deepEqual(codes(`---\ndensity: technical\n---\n\n# T\n\n## A\n${words(150)}\n`), []);
  assert.deepEqual(codes(`---\ndensity: technical\n---\n\n# T\n\n## A\n${words(170)}\n`), ["stop-dense"]);
  assert.deepEqual(codes(`# T\n\n## A\n${Array.from({ length: 6 }, (_, i) => `- point ${i}`).join("\n")}\n`), ["too-many-bullets"]);
  assert.deepEqual(codes(`# T\n\n## A\n\`\`\`\n${"x = 1\n".repeat(9)}\`\`\`\n`), ["long-code"]);
});

test("density: overflow says how far over; long code lines say where", () => {
  const over = check(`# T\n\n## A\n${words(200)}\n`).diagnostics[0];
  assert.match(over.message, /about \d+ lines too many at talk density/);
  const clipped = check(`# T\n\n## A\n\`\`\`\nshort\n${"y".repeat(80)}\n\`\`\`\n`).diagnostics[0];
  assert.equal(clipped.code, "code-line-clipped");
  assert.equal(clipped.line, 6);
});

test("density: bold-led bullets get a fix that turns them into child stops", () => {
  const items = Array.from({ length: 6 }, (_, i) => `- **Point ${i}:** ${words(6)}`).join("\n");
  const source = `# T\n\n## Many points\n${items}\n\n## Next\nx\n`;
  const r = check(source);
  assert.deepEqual(r.diagnostics.map(x => x.code), ["stop-dense", "too-many-bullets"]);
  const d = r.diagnostics[0];
  assert.match(d.fix!.description, /make them 6 ### stops/i);
  const edits = d.fix!.edits!;
  const { text } = applyEdits(source, edits);
  const after = check(text);
  assert.deepEqual(after.diagnostics.map(x => x.code), []);
  assert.deepEqual(after.deck.byId.get("many-points")!.children, ["point-0", "point-1", "point-2", "point-3", "point-4", "point-5"]);
  assert.equal(after.deck.byId.get("point-2")!.blocks.length, 1);
});

test("other stop problems: several media, empty stops, too deep", () => {
  assert.deepEqual(codes("# T\n\n## A\n![a](a.png)\n\n![b](b.png)\n", { "talk/a.png": PNG, "talk/b.png": PNG }), ["multiple-media"]);
  assert.deepEqual(codes("# T\n\n## A\n\n## B\nx\n"), ["empty-stop"]);
  assert.deepEqual(codes("# T\n\n## A\nx\n### B\nx\n#### C\nx\n##### D\nx\n"), ["too-deep"]);
});

test("notes: matched by title or {#id}; strays, repeats and stray text are flagged", () => {
  const deck = "# T\n\n## Intake {#intake}\nx\n\n## The fix\ny\n";
  const notes = "Loose text.\n\n# T\nOpen.\n\n## Intake\nBy title.\n\n## {#intake}\nAgain.\n\n## The fx\nTypo.\n";
  const r = check(deck, { "talk/deck.notes.md": notes });
  assert.deepEqual(r.diagnostics.map(d => [d.file, d.code, d.line]), [
    ["talk/deck.notes.md", "notes-preamble", 1],
    ["talk/deck.notes.md", "notes-duplicate", 9],
    ["talk/deck.notes.md", "notes-orphan", 12],
  ]);
  assert.match(r.diagnostics[2].message, /Did you mean "The fix"\?/);
  assert.equal(r.summary.withNotes, 2);
});

test("notes: an explicit notes path that doesn't exist is an error; none at all is fine", () => {
  assert.deepEqual(codes("---\nnotes: missing.md\n---\n\n# T\n\n## A\nx\n"), ["notes-file-missing"]);
  assert.equal(check("# T\n\n## A\nx\n").summary.withNotes, null);
  assert.equal(check("# T\n\n## A\nx\n", { "talk/deck.notes.md": "## A\nx\n" }, { notes: null }).notes, null);
});

test("diagnostics are ordered: deck first, by line, errors before warnings", () => {
  const r = check("# T\n\n## A\n![x](missing.png)\n\nSee [[nope]].\n", { "talk/deck.notes.md": "## Nope\n" });
  assert.deepEqual(r.diagnostics.map(d => d.code), ["missing-media", "broken-link", "notes-orphan"]);
});

test("the default route: reading order, pull-backs after branches, detours skipped", () => {
  const r = checkDeck("examples/pathway/pathway.md", nodeIo);
  const label = defaultRoute(r.deck).map(s => (s.kind === "map" ? (s.final ? "MAP" : "map") : s.kind === "lookback" ? `^${s.id}` : s.id));
  assert.deepEqual(label, [
    "map", "pathway", "corridors", "prezi", "impress", "^corridors", "map", "computed", "route", "detours", "^route",
    "explore", "^map", "motion", "flights", "remote", "^motion", "format", "next", "video", "tilt", "^next", "MAP",
  ]);
});

test("applyEdits: replace, insert and delete by original line numbers", () => {
  const text = "a\nb\nc\nd";
  assert.equal(applyEdits(text, [{ file: "f", startLine: 2, endLine: 3, newText: "B" }]).text, "a\nB\nc\nd");
  assert.equal(applyEdits(text, [{ file: "f", startLine: 3, endLine: 3, newText: "x\ny" }]).text, "a\nb\nx\ny\nc\nd");
  assert.equal(applyEdits(text, [{ file: "f", startLine: 1, endLine: 3, newText: "" }]).text, "c\nd");
  assert.equal(applyEdits(text, [
    { file: "f", startLine: 1, endLine: 2, newText: "A" },
    { file: "f", startLine: 4, endLine: 5, newText: "D" },
  ]).text, "A\nb\nc\nD");
  assert.equal(applyEdits(text, [
    { file: "f", startLine: 1, endLine: 3, newText: "X" },
    { file: "f", startLine: 2, endLine: 4, newText: "Y" },
  ]).applied, 1, "overlapping edits are skipped");
  assert.ok(readFileSync);
});
