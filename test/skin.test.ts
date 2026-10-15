import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { checkDeck } from "../src/check.ts";
import { readFont } from "../src/fontfile.ts";
import { memoryIo } from "../src/io.ts";
import { FACE_WIDTHS } from "../src/metrics.ts";
import { builtinMetrics, matchFace, resolveSkin, type SkinFace } from "../src/skin.ts";

const fontFile = (name: string) => new Uint8Array(readFileSync(new URL(`../skins/fonts/${name}`, import.meta.url)));
const CONDENSED = fontFile("barlow-condensed-latin-600-normal.woff2");
const MONO = fontFile("ibm-plex-mono-latin-400-normal.woff2");

// A tiny TrueType font, built by hand: printable ASCII mapped to glyphs 1 to 95,
// each glyph's advance 500 + its character code, at 1000 units per em.
function tinyTables(): Record<string, Uint8Array> {
  const be = (n: number, ...vals: number[]) => { const b = new Uint8Array(n * vals.length); vals.forEach((v, i) => { for (let k = 0; k < n; k++) b[i * n + k] = (v >>> (8 * (n - 1 - k))) & 0xff; }); return b; };
  const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
  const sub = cat(be(2, 4, 32, 0, 4, 4, 1, 0), be(2, 126, 0xffff), be(2, 0), be(2, 32, 0xffff), be(2, (1 - 32) & 0xffff, 1), be(2, 0, 0));
  const cmap = cat(be(2, 0, 1, 3, 1), be(4, 12), sub);
  const head = new Uint8Array(54); head.set(be(2, 1000), 18);
  const hhea = new Uint8Array(36); hhea.set(be(2, 96), 34);
  const hmtx = cat(be(2, 400, 0), ...Array.from({ length: 95 }, (_, i) => be(2, 500 + 32 + i, 0)));
  return { cmap, head, hhea, hmtx };
}
function sfnt(tables: Record<string, Uint8Array>): Uint8Array {
  const tags = Object.keys(tables).sort(), dirLen = 12 + 16 * tags.length;
  const out = new Uint8Array(dirLen + tags.reduce((a, t) => a + ((tables[t].length + 3) & ~3), 0));
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000); v.setUint16(4, tags.length);
  let at = dirLen;
  tags.forEach((t, i) => {
    for (let k = 0; k < 4; k++) out[12 + 16 * i + k] = t.charCodeAt(k);
    v.setUint32(12 + 16 * i + 8, at); v.setUint32(12 + 16 * i + 12, tables[t].length);
    out.set(tables[t], at); at += (tables[t].length + 3) & ~3;
  });
  return out;
}
function woff(tables: Record<string, Uint8Array>): Uint8Array {
  const tags = Object.keys(tables).sort(), packed = tags.map(t => new Uint8Array(deflateSync(tables[t])));
  const dirLen = 44 + 20 * tags.length;
  const out = new Uint8Array(dirLen + packed.reduce((a, p) => a + ((p.length + 3) & ~3), 0));
  const v = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]); v.setUint32(4, 0x00010000); v.setUint16(12, tags.length);
  let at = dirLen;
  tags.forEach((t, i) => {
    const r = 44 + 20 * i;
    for (let k = 0; k < 4; k++) out[r + k] = t.charCodeAt(k);
    v.setUint32(r + 4, at); v.setUint32(r + 8, packed[i].length); v.setUint32(r + 12, tables[t].length);
    out.set(packed[i], at); at += (packed[i].length + 3) & ~3;
  });
  return out;
}
const TINY_WIDTHS = Array.from({ length: 95 }, (_, i) => (532 + i) / 1000);

test("font files: widths from WOFF2 match the browser-measured tables exactly", () => {
  assert.deepEqual(readFont(CONDENSED).widths, [...FACE_WIDTHS.barlowCondensed600]);
  assert.deepEqual(readFont(MONO).widths, [...FACE_WIDTHS.plexMono400]);
  assert.equal(readFont(MONO).variable, false);
});

test("font files: TrueType and WOFF read the same widths", () => {
  assert.deepEqual(readFont(sfnt(tinyTables())).widths, TINY_WIDTHS);
  assert.deepEqual(readFont(woff(tinyTables())).widths, TINY_WIDTHS);
  assert.throws(() => readFont(new TextEncoder().encode("not a font at all")), /not a font file/);
});

test("weights: the face a browser would pick", () => {
  const face = (w: number, hi = w): SkinFace => ({ family: "Brand", weights: [w, hi], italic: false, src: `${w}`, path: null });
  const faces = [face(400), face(700)];
  assert.equal(matchFace(faces, "brand", 600)?.src, "700", "600 rounds up to bold");
  assert.equal(matchFace(faces, "Brand", 400)?.src, "400");
  assert.equal(matchFace([face(300), face(400)], "Brand", 600)?.src, "400", "or down when nothing is heavier");
  assert.equal(matchFace([face(300), face(700)], "Brand", 400)?.src, "300", "400 looks lighter before heavier");
  assert.equal(matchFace([face(100, 900)], "Brand", 600)?.src, "100", "a variable font covers its range");
  assert.equal(matchFace(faces, "Other", 400), null);
});

const skinIo = (css: string, extra: Record<string, Uint8Array | string> = {}) =>
  memoryIo({ "talk/deck.md": "---\nskin: ../brand/brand.css\n---\n# T\n\n## A\nx\n", "brand/brand.css": css, ...extra });

test("your skin: fonts from its own files, the rest from its base skin", () => {
  const css = `@font-face { font-family: "Brand Display"; src: url("Display.woff2"); font-weight: 600; }
:root { --base-skin: boardroom; --font-display: "Brand Display", sans-serif; --display-case: uppercase; --bend: winding; --route: #0A7F5A; }`;
  const skin = resolveSkin("../brand/brand.css", "talk/deck.md", skinIo(css, { "brand/Display.woff2": CONDENSED }));
  assert.deepEqual(skin.diagnostics, []);
  assert.equal(skin.base, "boardroom");
  assert.equal(skin.file, "brand/brand.css");
  assert.deepEqual([...skin.metrics.display], [...FACE_WIDTHS.barlowCondensed600]);
  assert.deepEqual(skin.metrics.body, builtinMetrics("boardroom").body);
  assert.equal(skin.metrics.displayUppercase, true);
  assert.equal(skin.bend, "winding");
  assert.equal(skin.faces[0].path, "brand/Display.woff2");
});

test("your skin: wider fonts make taller cards", () => {
  const deck = "---\nskin: ../brand/brand.css\n---\n# T\n\n## A\n" + "a fairly ordinary sentence that wraps across the card ".repeat(3) + "\n";
  const plain = checkDeck("talk/deck.md", memoryIo({ "talk/deck.md": deck.replace("../brand/brand.css", "boardroom") }));
  const wide = checkDeck("talk/deck.md", memoryIo({
    "talk/deck.md": deck,
    "brand/brand.css": `@font-face { font-family: "Wide"; src: url("Wide.woff2"); } :root { --base-skin: boardroom; --font-body: "Wide"; }`,
    "brand/Wide.woff2": MONO,
  }));
  assert.ok(wide.estimates.get("a")!.ratio > plain.estimates.get("a")!.ratio);
});

test("your skin: what can go wrong, and what the checker says", () => {
  const codes = (css: string, extra = {}) => resolveSkin("../brand/brand.css", "talk/deck.md", skinIo(css, extra), 2).diagnostics.map(d => d.code);
  assert.deepEqual(resolveSkin("../nope.css", "talk/deck.md", skinIo("")).diagnostics.map(d => d.code), ["skin-not-found"]);
  assert.deepEqual(codes(":root { --base-skin: fancy; }"), ["skin-base-unknown"]);
  assert.deepEqual(codes(`@font-face { font-family: B; src: url("gone.woff2"); } :root { --font-body: B; }`), ["skin-font-missing"]);
  assert.deepEqual(codes(`@font-face { font-family: B; src: url("https://fonts.example/b.woff2"); }`), ["skin-font-missing"]);
  assert.deepEqual(codes(":root { --font-body: Helvetica; }"), ["skin-font-unmeasured"]);
  assert.deepEqual(codes(":root { --base-skin: boardroom; --font-body: Barlow; }"), ["skin-font-unmeasured"], "the other skin's fonts aren't loaded");
  assert.deepEqual(codes(":root { --base-skin: boardroom; --font-body: 'IBM Plex Sans'; }"), [], "the base skin's fonts are");
  assert.deepEqual(codes(`@font-face { font-family: B; src: url("b.woff2"); } :root { --font-body: B; }`, { "brand/b.woff2": "junk" }), ["skin-font-unreadable"]);
  assert.deepEqual(codes(":root { --bend: wiggly; }"), ["skin-bend-unknown"]);
  const d = resolveSkin("../nope.css", "talk/deck.md", skinIo(""), 2).diagnostics[0];
  assert.equal(d.line, 2, "points at the skin line in the frontmatter");
});
