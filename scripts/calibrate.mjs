// Measures real card heights in a browser and compares them with the checker's
// estimates. Each deck is built with the real engine, once per skin, and the
// page reports the natural height of every card at the reference width.
//
//   node scripts/calibrate.mjs <deck.md>... [--write test/calibration.json]
//
// Needs the playwright package. The test suite reads the written file, so the
// estimator stays honest without a browser in CI.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDeck } from "../src/check.ts";
import { compileDeck } from "../src/compile.ts";
import { estimateStop } from "../src/layout.ts";
import { imageSize } from "../src/media.ts";
import { nodeIo } from "../src/io-node.ts";
import { loadAssets, renderPage } from "../src/page.ts";
import { parseDeck } from "../src/parse.ts";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require(resolve(execSync("npm root -g").toString().trim(), "playwright")); } })();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const writeAt = args.includes("--write") ? args[args.indexOf("--write") + 1] : null;
const decks = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--write");
const SKINS = ["sectional", "boardroom"];

const browser = await chromium.launch();
const results = [];
for (const deckPath of decks) {
  const measured = {};
  for (const skin of SKINS) {
    const check = checkDeck(deckPath, nodeIo, { notes: null });
    check.deck.meta.skin = skin;
    const { payload, media } = compileDeck(check, nodeIo);
    const assets = loadAssets(skin);
    const scratch = mkdtempSync(join(tmpdir(), "pathway-calibrate-"));
    writeFileSync(join(scratch, "index.html"), renderPage(payload, assets));
    for (const rel of media) { mkdirSync(dirname(join(scratch, rel)), { recursive: true }); copyFileSync(join(dirname(deckPath), rel), join(scratch, rel)); }
    mkdirSync(join(scratch, "fonts"));
    for (const f of assets.fonts) copyFileSync(join(root, "skins/fonts", f), join(scratch, "fonts", f));
    const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await tab.goto(`${pathToFileURL(join(scratch, "index.html")).href}?capture`);
    await tab.evaluate(() => window.pathway.ready);
    const broken = await tab.evaluate(() => [...document.querySelectorAll("#world img")].filter(img => !img.naturalWidth).map(img => img.getAttribute("src")));
    if (broken.length) throw new Error(`images failed to load in the browser: ${broken.join(", ")}`);
    measured[skin] = (await tab.evaluate(() => window.pathway.measure())).map(({ title, ratio }) => ({ title, ratio }));
    await tab.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  results.push({ deck: deckPath, measured });
}
await browser.close();

// Compare with the estimator.
let worst = 0;
for (const r of results) {
  const deck = parseDeck(readFileSync(r.deck, "utf8"), r.deck);
  const dir = dirname(r.deck);
  for (const skin of SKINS) {
    console.log(`\n${r.deck} · ${skin}`);
    deck.stops.forEach((stop, i) => {
      const m = r.measured[skin][i];
      const est = estimateStop(stop, { skin, density: stop.density ?? deck.meta.density, isRoot: stop === deck.root, aspect: media => { const b = nodeIo.head(nodeIo.join(dir, media.src), 65536); const s = b && imageSize(b); return s ? s.height / s.width : null; } });
      const diff = est.ratio - m.ratio;
      worst = Math.max(worst, Math.abs(diff));
      console.log(`  ${(diff >= 0 ? "+" : "") + diff.toFixed(3)}  browser ${m.ratio.toFixed(3)}  estimate ${est.ratio.toFixed(3)}  ${stop.title}${m.title.toLowerCase() !== stop.title.toLowerCase() ? `  (MISMATCH: ${m.title})` : ""}`);
    });
  }
}
console.log(`\nworst difference: ${worst.toFixed(3)} of card width`);
if (writeAt) { writeFileSync(writeAt, `${JSON.stringify(results, null, 2)}\n`); console.log(`wrote ${writeAt}`); }
