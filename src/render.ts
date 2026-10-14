// `pathway render`: pictures of a deck as the audience sees it, so you (or an
// agent) can look at a stop without presenting. Needs Playwright, which is
// optional: everything else in Pathway works without a browser.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDeck } from "./build.ts";

export interface RenderOptions {
  /** Stop ids, or "map" for the whole map. */
  targets: string[];
  /** A folder for several pictures; a .png path for one. */
  out: string;
  width: number;
  height: number;
  /** Device pixel ratio: 2 for sharper pictures. */
  scale: number;
  theme?: "dark" | "light";
}

export interface Rendered {
  files: string[];
  /** Stops whose content came out taller than their card. */
  overflowing: string[];
  unknown: string[];
}

interface Chromium { launch(o?: object): Promise<{ newPage(o?: object): Promise<Page>; close(): Promise<void> }> }
interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<T>(f: (arg: never) => T | Promise<T>, arg?: unknown): Promise<T>;
  screenshot(o: { path: string }): Promise<unknown>;
}

function loadChromium(): Chromium {
  const require = createRequire(import.meta.url);
  const tries = [() => require("playwright"), () => require("playwright-core")];
  try {
    const globalRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
    tries.push(() => require(join(globalRoot, "playwright")));
  } catch { /* npm isn't on the path */ }
  for (const t of tries) {
    try { return (t() as { chromium: Chromium }).chromium; } catch { /* try the next */ }
  }
  throw new Error("pathway render needs Playwright and its Chromium: npm install playwright && npx playwright install chromium");
}

export async function renderStills(deckPath: string, opts: RenderOptions): Promise<Rendered> {
  const chromium = loadChromium();
  const tmp = mkdtempSync(join(tmpdir(), "pathway-render-"));
  try {
    const built = buildDeck(deckPath, { out: join(tmp, "deck"), force: true });
    const ids = new Set(built.check.deck.stops.map(s => s.id));
    const unknown = opts.targets.filter(t => t !== "map" && !ids.has(t));
    const targets = opts.targets.filter(t => t === "map" || ids.has(t));
    const single = targets.length === 1 && /\.png$/i.test(opts.out);
    if (!single) mkdirSync(opts.out, { recursive: true });
    else mkdirSync(dirname(resolve(opts.out)), { recursive: true });

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.scale });
      const query = `?capture${opts.theme ? `&theme=${opts.theme}` : ""}`;
      await page.goto(`${pathToFileURL(join(built.out!, "index.html")).href}${query}`);
      await page.evaluate(() => window.pathway!.ready);
      const files: string[] = [];
      for (const t of targets) {
        await page.evaluate((id: string) => window.pathway!.show(id), t as never);
        const path = single ? opts.out : join(opts.out, `${t}.png`);
        await page.screenshot({ path });
        files.push(path);
      }
      const overflowing = await page.evaluate(() => window.pathway!.overflowing());
      return { files, overflowing, unknown };
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
