// The checker's size estimate, held to real browser measurements. To refresh the
// measurements after changing the type scale or fonts, run:
//   node scripts/calibrate.mjs examples/pathway/pathway.md test/fixtures/calibration/calibration.md test/fixtures/kitchen/kitchen.md --write test/calibration.json

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nodeIo } from "../src/io-node.ts";
import { estimateStop, wrapLines } from "../src/layout.ts";
import { imageSize } from "../src/media.ts";
import { FACE_WIDTHS } from "../src/metrics.ts";
import { parseDeck } from "../src/parse.ts";
import { builtinMetrics } from "../src/skin.ts";
import { CARD } from "../src/typography.ts";

interface Calibration { deck: string; measured: Record<string, { title: string; ratio: number }[]> }
const calibration: Calibration[] = JSON.parse(readFileSync(new URL("./calibration.json", import.meta.url), "utf8"));

/** Within a quarter of a line of body text for cards that fit; a line and a half for cards over the cap. */
const TOLERANCE = { fits: 0.012, over: 0.07 };

for (const c of calibration) {
  const deck = parseDeck(readFileSync(c.deck, "utf8"), c.deck);
  const dir = nodeIo.dirname(c.deck);
  const aspect = (src: string) => { const b = nodeIo.head(nodeIo.join(dir, src), 65536); const s = b && imageSize(b); return s ? s.height / s.width : null; };
  for (const [skin, cards] of Object.entries(c.measured)) {
    test(`estimates match the browser: ${c.deck} (${skin})`, () => {
      assert.equal(cards.length, deck.stops.length, "one measurement per stop");
      const misses: string[] = [];
      deck.stops.forEach((stop, i) => {
        const browser = cards[i].ratio;
        const est = estimateStop(stop, { metrics: builtinMetrics(skin), density: stop.density ?? deck.meta.density, isRoot: stop === deck.root, aspect: m => aspect(m.src) });
        const tol = browser > CARD.ratioMax ? TOLERANCE.over : TOLERANCE.fits;
        if (Math.abs(est.ratio - browser) > tol) misses.push(`${stop.title}: browser ${browser}, estimate ${est.ratio.toFixed(4)}`);
        // Overflow verdicts must agree whenever the browser isn't right at the cap.
        if (Math.abs(browser - CARD.ratioMax) > tol) assert.equal(est.overflow, browser > CARD.ratioMax, `overflow verdict for "${stop.title}"`);
      });
      assert.deepEqual(misses, []);
    });
  }
}

test("wrapLines breaks like a browser: greedy, word by word", () => {
  // Monospace makes the arithmetic exact: every character is 0.6em.
  const mono = { body: FACE_WIDTHS.plexMono400, strong: FACE_WIDTHS.plexMono400, mono: FACE_WIDTHS.plexMono400 };
  // "abcd" is 2.4em and a space 0.6em, so a 10em line holds 3 words (8.4em) but not 4 (11.4em).
  assert.equal(wrapLines([{ text: "abcd ".repeat(40).trim(), style: "normal" }], 10, mono), 14);
  assert.equal(wrapLines([{ text: "abcd abcd abcd", style: "normal" }], 8.4, mono), 1);
  assert.equal(wrapLines([{ text: "abcd abcd abcd", style: "normal" }], 8.39, mono), 2);
  assert.equal(wrapLines([], 10, mono), 0);
  // A word longer than the line still takes exactly one line (browsers don't break words).
  assert.equal(wrapLines([{ text: "x".repeat(50), style: "normal" }], 5, mono), 1);
  // Uppercase is measured as uppercase.
  const barlow = { body: FACE_WIDTHS.barlowCondensed600, strong: FACE_WIDTHS.barlowCondensed600, mono: FACE_WIDTHS.plexMono400 };
  const lower = wrapLines([{ text: "the route is reading order ".repeat(6), style: "normal" }], 30, barlow);
  const upper = wrapLines([{ text: "the route is reading order ".repeat(6), style: "normal" }], 30, barlow, { uppercase: true });
  assert.ok(upper > lower);
});
