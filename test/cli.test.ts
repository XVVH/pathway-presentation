import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const scratch = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "pathway-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

test("check: a clean deck exits 0, and --json reports the summary", () => {
  const r = run("check", "examples/pathway/pathway.md", "--json");
  assert.equal(r.code, 0);
  const json = JSON.parse(r.out);
  assert.equal(json.version, 1);
  assert.equal(json.notes, "examples/pathway/pathway.notes.md");
  assert.deepEqual(json.summary, { errors: 0, warnings: 0, infos: 0, stops: 19, detours: 3, withNotes: 12 });
  assert.deepEqual(json.diagnostics, []);
});

test("check: errors exit 1 and are listed with line, code and fix", () => {
  const dir = scratch({ "deck.md": "# T\n\n## Intake\nx\n\n## B\nSee [[Intake]].\n" });
  const human = run("check", join(dir, "deck.md"));
  assert.equal(human.code, 1);
  assert.match(human.out, /7:5 {2}error {4}broken-link/);
  assert.match(human.out, /→ Link to \[\[intake\]\]\. \(pathway check --fix applies this\)/);
  const json = JSON.parse(run("check", join(dir, "deck.md"), "--json").out);
  assert.deepEqual(json.diagnostics.map((d: { code: string; line: number }) => [d.code, d.line]), [["broken-link", 7]]);
  assert.equal(json.diagnostics[0].fix.safe, true);
});

test("check --strict: warnings fail too", () => {
  const dir = scratch({ "deck.md": "# T\n\n## A {.detuor}\nx\n" });
  assert.equal(run("check", join(dir, "deck.md")).code, 0);
  assert.equal(run("check", join(dir, "deck.md"), "--strict").code, 1);
});

test("check --fix: applies safe fixes and checks again", () => {
  const dir = scratch({ "deck.md": "# T\n\n## Intake\nx\n\n## B\nSee [[Intake]] and [[intak]].\n" });
  const r = run("check", join(dir, "deck.md"), "--fix");
  assert.match(r.err, /Applied 1 fix\./);
  assert.equal(readFileSync(join(dir, "deck.md"), "utf8"), "# T\n\n## Intake\nx\n\n## B\nSee [[intake]] and [[intak]].\n");
  assert.equal(r.code, 1, "the typo isn't safe to fix, so it remains");
});

test("check --no-notes and --notes", () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nx\n", "deck.notes.md": "## A\nSay this.\n", "other.md": "## Nope\n" });
  assert.equal(JSON.parse(run("check", join(dir, "deck.md"), "--json").out).summary.withNotes, 1);
  assert.equal(JSON.parse(run("check", join(dir, "deck.md"), "--json", "--no-notes").out).summary.withNotes, null);
  const other = JSON.parse(run("check", join(dir, "deck.md"), "--json", "--notes", join(dir, "other.md")).out);
  assert.deepEqual(other.diagnostics.map((d: { code: string }) => d.code), ["notes-orphan"]);
});

test("outline: the tree, the route, and the same as JSON", () => {
  const human = run("outline", "examples/pathway/pathway.md");
  assert.equal(human.code, 0);
  assert.match(human.out, /^Pathway {2}#pathway/);
  assert.match(human.out, /└─ PowerPoint had the return {2}#powerpoint · 15 words · detour/);
  assert.match(human.out, /exec: corridors › map › motion › next/);
  const json = JSON.parse(run("outline", "examples/pathway/pathway.md", "--json").out);
  assert.equal(json.stops.length, 19);
  assert.deepEqual(json.stops[1], {
    id: "corridors", title: "Decks are corridors", line: 13, level: 2, depth: 1, parent: "pathway",
    children: ["prezi", "impress", "powerpoint"], detour: false, density: null, words: 35, bullets: 3,
    media: [], links: [], hasNotes: true, card: json.stops[1].card,
  });
  assert.equal(json.stops[1].card.fitted, 0.5625);
  assert.deepEqual(json.route[0], { kind: "map", final: false });
});

test("usage errors exit 2", () => {
  assert.equal(run().code, 2);
  assert.equal(run("explode", "deck.md").code, 2);
  assert.equal(run("check").code, 2);
  assert.equal(run("check", "no/such/deck.md").code, 2);
  assert.equal(run("check", "a.md", "--bogus").code, 2);
  assert.equal(run("--help").code, 0);
  assert.match(run("--version").out, /^\d+\.\d+\.\d+\n$/);
});
