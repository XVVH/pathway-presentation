import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildDeck } from "../src/build.ts";
import { formatDeck } from "../src/fmt.ts";
import { parseDeck } from "../src/parse.ts";
import { present } from "../src/serve.ts";

const scratch = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "pathway-build-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};
const payloadOf = (html: string) => JSON.parse(/<script type="application\/json" id="pathway-data">(.*?)<\/script>/s.exec(html)![1]);

test("build: a folder with the page, the media it uses, and the skin's fonts", () => {
  const out = join(mkdtempSync(join(tmpdir(), "pathway-out-")), "talk");
  const r = buildDeck("examples/pathway/pathway.md", { out });
  assert.equal(r.out, out);
  assert.deepEqual(r.files.filter(f => !f.startsWith("fonts/")), ["index.html", "media/flight.mp4", "media/grammar.svg"]);
  assert.ok(r.files.includes("fonts/barlow-latin-400-normal.woff2"));
  assert.ok(r.files.includes("fonts/OFL-Barlow.txt"));
  assert.ok(!r.files.some(f => f.includes("plex-sans")), "only the skin's own fonts");
  const payload = payloadOf(readFileSync(join(out, "index.html"), "utf8"));
  assert.equal(payload.notes, null);
  assert.equal(payload.dev, false);
});

test("build: notes go in only with --with-notes", () => {
  const out = join(mkdtempSync(join(tmpdir(), "pathway-out-")), "talk");
  buildDeck("examples/pathway/pathway.md", { out, withNotes: true });
  assert.equal(Object.keys(payloadOf(readFileSync(join(out, "index.html"), "utf8")).notes).length, 12);
});

test("build: refuses a deck with errors unless forced", () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nSee [[nowhere]].\n" });
  const r = buildDeck(join(dir, "deck.md"));
  assert.equal(r.out, null);
  assert.ok(!existsSync(join(dir, "deck-build")));
  const forced = buildDeck(join(dir, "deck.md"), { force: true });
  assert.equal(forced.out, join(dir, "deck-build"));
  assert.ok(existsSync(join(dir, "deck-build", "index.html")));
});

test("build: replaces its own earlier build, but never someone else's folder", () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nx\n", "mine/notes.txt": "keep me" });
  const deck = join(dir, "deck.md");
  buildDeck(deck);
  writeFileSync(join(dir, "deck-build", "stale.txt"), "old");
  buildDeck(deck);
  assert.ok(!existsSync(join(dir, "deck-build", "stale.txt")));
  assert.throws(() => buildDeck(deck, { out: join(dir, "mine") }), /isn't a Pathway build/);
  assert.equal(readFileSync(join(dir, "mine/notes.txt"), "utf8"), "keep me");
  assert.throws(() => buildDeck(deck, { out: dir }), /holds the deck/);
});

test("present: serves the page with notes, the deck's media and fonts, and nothing else", async () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\n![x](media/a.svg)\n\n## B\nx\n", "deck.notes.md": "## A\nSay hello.\n", "media/a.svg": "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='3'/>", "secret.txt": "no" });
  const p = await present(join(dir, "deck.md"), { port: 0 });
  try {
    const get = (path: string, headers: Record<string, string> = {}) => fetch(new URL(path, p.url), { headers });
    const page = await get("/");
    assert.equal(page.status, 200);
    const payload = payloadOf(await page.text());
    assert.equal(payload.dev, true);
    assert.match(payload.notes.a, /Say hello/);
    assert.equal((await get("/media/a.svg")).status, 200);
    assert.equal((await get("/fonts/barlow-latin-400-normal.woff2")).status, 200);
    for (const path of ["/secret.txt", "/deck.md", "/deck.notes.md", "/media/../secret.txt", "/%2e%2e/package.json"]) assert.equal((await get(path)).status, 404, path);
    const range = await get("/media/a.svg", { Range: "bytes=0-3" });
    assert.equal(range.status, 206);
    assert.equal((await range.text()).length, 4);
    assert.equal(new URL(p.url).hostname, "127.0.0.1");
  } finally {
    await p.close();
  }
});

test("present: answers only to its own host name", async () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nx\n" });
  const p = await present(join(dir, "deck.md"), { port: 0 });
  try {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(p.url);
      request({ host: u.hostname, port: u.port, path: "/", headers: { Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject).end();
    });
    assert.equal(status, 421);
  } finally {
    await p.close();
  }
});

test("present: tells the page to reload when the deck changes", async () => {
  const dir = scratch({ "deck.md": "# T\n\n## A\nx\n" });
  const p = await present(join(dir, "deck.md"), { port: 0 });
  try {
    const res = await fetch(new URL("/__pathway/events", p.url));
    const reader = res.body!.getReader();
    await reader.read();
    writeFileSync(join(dir, "deck.md"), "# T\n\n## A\ny\n");
    const deadline = Date.now() + 5000;
    let text = "";
    while (!text.includes("event: reload") && Date.now() < deadline) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: reload/);
    await reader.cancel();
  } finally {
    await p.close();
  }
});

test("fmt: tidies layout and leaves meaning alone", () => {
  const messy = "---\ntitle: T\n---\n\n\n#   T  \nLead.   \n\n\n\n##A\n## B ##\nText with a hard break  \nnext line.\n```\n\n\n\ncode   \n```\n    indented\n\n\n    code\n- item\n  ### nested\n";
  const tidy = formatDeck(messy);
  assert.equal(tidy, "---\ntitle: T\n---\n\n# T\nLead.\n\n##A\n\n## B\nText with a hard break  \nnext line.\n```\n\n\n\ncode   \n```\n    indented\n\n\n    code\n- item\n\n  ### nested\n");
  assert.equal(formatDeck(tidy), tidy, "idempotent");
  const shape = (s: string) => parseDeck(s, "d.md").stops.map(x => [x.id, x.level, x.blocks.map(b => b.kind)]);
  assert.deepEqual(shape(tidy), shape(messy));
});

test("fmt: the example deck is already tidy", () => {
  for (const f of ["examples/pathway/pathway.md"]) {
    const s = readFileSync(f, "utf8");
    assert.equal(formatDeck(s), s, f);
  }
});

test("present: serves your skin's fonts, and not the rest of its folder", async () => {
  const dir = scratch({
    "talk/deck.md": "---\nskin: ../brand/brand.css\n---\n# T\n\n## A\nx\n",
    "brand/brand.css": `@font-face { font-family: "Brand"; src: url("Brand.woff2"); } :root { --font-body: "Brand"; }`,
    "brand/secret.txt": "no",
  });
  writeFileSync(join(dir, "brand/Brand.woff2"), readFileSync("skins/fonts/barlow-latin-400-normal.woff2"));
  const p = await present(join(dir, "talk/deck.md"), { port: 0 });
  try {
    assert.equal((await fetch(new URL("/fonts/skin/Brand.woff2", p.url))).status, 200);
    assert.equal((await fetch(new URL("/fonts/skin/secret.txt", p.url))).status, 404);
    assert.match(await (await fetch(p.url)).text(), /url\("fonts\/skin\/Brand\.woff2"\)/);
    // Editing the skin, outside the deck's folder, reloads the page.
    const reader = (await fetch(new URL("/__pathway/events", p.url))).body!.getReader();
    await reader.read();
    writeFileSync(join(dir, "brand/brand.css"), `@font-face { font-family: "Brand"; src: url("Brand.woff2"); } :root { --font-body: "Brand"; --route: red; }`);
    const deadline = Date.now() + 5000;
    let text = "";
    while (!text.includes("event: reload") && Date.now() < deadline) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: reload/);
    await reader.cancel();
  } finally {
    await p.close();
  }
});
