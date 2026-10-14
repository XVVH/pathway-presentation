// Measures real card heights in a browser and compares them with the checker's
// estimates. The prototype in spike/ is the reference renderer for now.
//
//   node scripts/calibrate.mjs <deck.md>... [--write test/calibration.json]
//
// Needs the playwright package. The test suite reads the written file, so the
// estimator stays honest without a browser in CI.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDeck } from "../src/parse.ts";
import { estimateStop } from "../src/layout.ts";
import { imageSize } from "../src/media.ts";
import { nodeIo } from "../src/io-node.ts";

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
  const source = readFileSync(deckPath, "utf8");
  // Embed the deck in a copy of the prototype, in a scratch folder holding the
  // deck's media and a link to the prototype's fonts.
  const scratch = resolve(root, "spike/.calibrate");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(resolve(scratch, "media"), { recursive: true });
  const deckMedia = resolve(dirname(resolve(deckPath)), "media");
  if (existsSync(deckMedia)) cpSync(deckMedia, resolve(scratch, "media"), { recursive: true });
  symlinkSync(resolve(root, "spike/media/fonts"), resolve(scratch, "media/fonts"));
  const html = readFileSync(resolve(root, "spike/index.html"), "utf8").replace(/(<script type="text\/markdown" id="deck">\n)[\s\S]*?(<\/script>)/, `$1${source}\n$2`);
  const page = resolve(scratch, "index.html");
  writeFileSync(page, html);
  const measured = {};
  for (const skin of SKINS) {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await tab.goto(`${pathToFileURL(page).href}?skin=${skin}&cards=fitted`);
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(400);
    measured[skin] = await tab.evaluate(async () => {
      await Promise.all([...document.querySelectorAll("#world img")].map(img => img.decode().catch(() => {})));
      const broken = [...document.querySelectorAll("#world img")].filter(img => !img.naturalWidth).map(img => img.getAttribute("src"));
      if (broken.length) return { broken };
      const box = document.createElement("div"); box.className = "measure"; document.body.appendChild(box);
      const out = [...document.querySelectorAll("#world .card")].map(card => {
        const clone = card.cloneNode(true); clone.removeAttribute("style"); clone.querySelector(".bars")?.remove();
        box.appendChild(clone);
        const r = clone.offsetHeight / box.clientWidth; clone.remove();
        return { title: card.querySelector("h1, h2").textContent, ratio: Math.round(r * 10000) / 10000 };
      });
      box.remove();
      return out;
    });
    await tab.close();
    if (measured[skin].broken) throw new Error(`images failed to load in the browser: ${measured[skin].broken.join(", ")}`);
  }
  rmSync(scratch, { recursive: true, force: true });
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
