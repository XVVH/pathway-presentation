import assert from "node:assert/strict";
import { test } from "node:test";
import jsQRModule from "jsqr";
import { checkDeck } from "../src/check.ts";
import { compileDeck } from "../src/compile.ts";
import { checkUrl } from "../src/frontmatter.ts";
import { memoryIo } from "../src/io.ts";
import { parseDeck } from "../src/parse.ts";
import { qrModules, qrSvg } from "../src/qr.ts";

// The decoder is a CommonJS module; its function is the default export or the module itself.
const jsQR = ((jsQRModule as unknown as { default?: unknown }).default ?? jsQRModule) as (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;

/** Draws the code's modules as pixels, with a quiet zone, and reads it back the way a phone would. */
function decode(url: string): string | null {
  const modules = qrModules(url), scale = 6, quiet = 4, n = modules.length, size = (n + 2 * quiet) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }));
  return jsQR(px, size, size)?.data ?? null;
}

const compile = (deck: string, opts = {}) => {
  const io = memoryIo({ "talk/deck.md": deck });
  return compileDeck(checkDeck("talk/deck.md", io), io, opts).payload;
};

test("QR codes read back as the address, including long and non-ASCII ones", () => {
  for (const url of ["https://slides.example.com/pathway/", "https://intranet.example.com/talks/2026/why-pipelines-stall/?from=qr", "https://example.com/café/ü"]) {
    assert.equal(decode(url), new URL(url).href);
  }
  assert.match(qrSvg("https://example.com/"), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+".*<rect[^>]*fill="#fff"\/><path d="M/);
});

test("url: a full web address, or an error", () => {
  assert.equal(checkUrl("https://intranet.example.com/talks/x"), "https://intranet.example.com/talks/x");
  assert.equal(checkUrl("intranet/talks/x"), null);
  assert.equal(checkUrl("javascript:alert(1)"), null);
  assert.equal(checkUrl("file:///talks/x"), null);
  const r = checkDeck("talk/deck.md", memoryIo({ "talk/deck.md": "---\nurl: not a url\n---\n# T\n\n## A\nx\n" }));
  assert.deepEqual(r.diagnostics.map(d => [d.code, d.line]), [["url-invalid", 2]]);
});

test("the bottom line: under the title, never on a card, and flagged anywhere else", () => {
  const deck = "# T\nLede.\n\n::: takeaways\n- One.\n- Two.\n:::\n\n## A\nx\n\n::: takeaways\nMisplaced.\n:::\n";
  const parsed = parseDeck(deck, "d.md");
  assert.equal(parsed.root!.takeaways.length, 1);
  assert.deepEqual(parsed.diagnostics.map(d => [d.code, d.line]), [["takeaways-misplaced", 12]]);
  const payload = compile(deck);
  assert.equal(payload.takeaways, "<ul>\n<li>One.</li>\n<li>Two.</li>\n</ul>");
  assert.equal(payload.stops[0].body, "<p>Lede.</p>");
  assert.equal(payload.stops[1].body, "<p>x</p>");
  assert.equal(compile("# T\n\n## A\nx\n").takeaways, null);
});

test("handoff: from the deck's url, or the build's, which wins", () => {
  const deck = "---\nurl: https://intranet.example.com/talks/x/\n---\n# T\n\n## A\nx\n";
  const fromDeck = compile(deck).handoff!;
  assert.equal(fromDeck.url, "https://intranet.example.com/talks/x/");
  assert.match(fromDeck.qr, /^<svg/);
  assert.equal(compile(deck, { url: "https://slides.example.com/client/" }).handoff!.url, "https://slides.example.com/client/");
  assert.equal(compile("# T\n\n## A\nx\n").handoff, null);
});
