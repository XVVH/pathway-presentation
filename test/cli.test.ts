import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  assert.equal(json.notes, null, "the example's notes are written in the deck");
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
    id: "corridors", title: "Decks are corridors", line: 17, level: 2, depth: 1, parent: "pathway",
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

test("build: refuses a broken deck, builds a clean one, and says where", () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nSee [[nowhere]].\n" });
  const broken = run("build", join(dir, "deck.md"));
  assert.equal(broken.code, 1);
  assert.match(broken.err, /Not built: the deck has errors/);
  writeFileSync(join(dir, "deck.md"), "# T\n\n## A\nFine.\n");
  const ok = run("build", join(dir, "deck.md"));
  assert.equal(ok.code, 0);
  assert.match(ok.out, /Built .*deck-build\/index\.html \(0 media files\)/);
  assert.match(readFileSync(join(dir, "deck-build", "index.html"), "utf8"), /<title>T<\/title>/);
  assert.match(run("build", join(dir, "deck.md"), "--with-notes").err, /There were no speaker notes to include/);
  writeFileSync(join(dir, "deck.md"), "# T\n\n## A\nFine.\n\n::: notes\nSay hello.\n:::\n");
  assert.match(run("build", join(dir, "deck.md"), "--with-notes").err, /Speaker notes for 1 stop are included/);
});

test("fmt: prints, checks or rewrites", () => {
  const dir = scratch({ "deck.md": "# T\n## A   \nx\n\n\n" });
  assert.equal(run("fmt", join(dir, "deck.md")).out, "# T\n\n## A\nx\n");
  assert.equal(run("fmt", "--check", join(dir, "deck.md")).code, 1);
  assert.equal(run("fmt", "--write", join(dir, "deck.md")).code, 0);
  assert.equal(readFileSync(join(dir, "deck.md"), "utf8"), "# T\n\n## A\nx\n");
  assert.equal(run("fmt", "--check", join(dir, "deck.md")).code, 0);
  assert.equal(run("fmt", "--check", "--write", join(dir, "deck.md")).code, 2);
});

test("render and present explain their options", () => {
  assert.equal(run("render", "examples/pathway/pathway.md").code, 2);
  assert.equal(run("render", "examples/pathway/pathway.md", "--map", "--size", "big").code, 2);
  assert.equal(run("present", "examples/pathway/pathway.md", "--port", "99999").code, 2);
});

test("inline-notes: shows what would move, then moves it and removes the empty notes file", () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nOne.\n\n## B\nTwo.\n", "deck.notes.md": "## A\nSay one.\n\n## Gone\nLost.\n" });
  const dry = run("inline-notes", join(dir, "deck.md"));
  assert.equal(dry.code, 0);
  assert.match(dry.out, /Would move notes for 1 stop/);
  assert.match(dry.out, /Stays in .*'Gone' \(line 4\), because it matches no stop/);
  assert.equal(readFileSync(join(dir, "deck.md"), "utf8"), "# T\n\n## A\nOne.\n\n## B\nTwo.\n", "a dry run changes nothing");
  assert.equal(run("inline-notes", join(dir, "deck.md"), "--write").code, 0);
  assert.equal(readFileSync(join(dir, "deck.md"), "utf8"), "# T\n\n## A\nOne.\n\n::: notes\nSay one.\n:::\n\n## B\nTwo.\n");
  assert.equal(readFileSync(join(dir, "deck.notes.md"), "utf8"), "## Gone\nLost.\n");
  writeFileSync(join(dir, "deck.notes.md"), "## B\nSay two.\n");
  run("inline-notes", join(dir, "deck.md"), "--write");
  assert.ok(!existsSync(join(dir, "deck.notes.md")));
  assert.match(readFileSync(join(dir, "deck.md"), "utf8"), /## B\nTwo\.\n\n::: notes\nSay two\.\n:::\n$/);
  assert.equal(run("inline-notes", join(dir, "deck.md")).code, 1, "nothing left to move");
});

test("new-skin, then a build that carries the skin's fonts and says so", () => {
  const dir = scratch({ "deck.md": "---\nskin: skins/brand.css\n---\n# T\n\n## A\nx\n" });
  assert.equal(run("new-skin", join(dir, "skins", "brand.css")).code, 0);
  assert.equal(run("new-skin", join(dir, "skins", "brand.css")).code, 1, "never overwrites");
  assert.equal(run("new-skin", join(dir, "x.css"), "--from", "nope").code, 2);
  const starter = readFileSync(join(dir, "skins", "brand.css"), "utf8");
  assert.match(starter, /--base-skin: boardroom;/);
  assert.equal(run("check", join(dir, "deck.md")).code, 0, "the starter checks clean");
  writeFileSync(join(dir, "skins", "Brand-Bold.woff2"), readFileSync("skins/fonts/barlow-condensed-latin-600-normal.woff2"));
  writeFileSync(join(dir, "skins", "brand.css"), `@font-face { font-family: "Brand"; src: url("Brand-Bold.woff2"); font-weight: 700; }\n${starter.replace('--font-display: "IBM Plex Sans"', '--font-display: "Brand"')}`);
  const built = run("build", join(dir, "deck.md"));
  assert.equal(built.code, 0, built.err);
  assert.match(built.err, /includes your skin's fonts \(Brand-Bold\.woff2\)\. Check their licence/);
  assert.ok(existsSync(join(dir, "deck-build", "fonts", "skin", "Brand-Bold.woff2")));
  assert.match(readFileSync(join(dir, "deck-build", "index.html"), "utf8"), /src: url\("fonts\/skin\/Brand-Bold\.woff2"\)/);
});
