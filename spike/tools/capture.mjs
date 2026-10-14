// Renders the prototype's route to an MP4 by stepping its clock frame by frame
// in headless Chromium and piping screenshots to ffmpeg. Nothing plays in real
// time, so the output is identical on every run and on any machine.
//
//   node spike/tools/capture.mjs [--out tour.mp4] [--fps 30] [--size 1280x720]
//        [--scale 1.5] [--skin boardroom] [--motion remote] [--dark]
//        [--frames-at 0,12.5,30 --shots-dir dir]   (stills instead of video)
//
// Needs Node 18+, ffmpeg on PATH, and the playwright package.

import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require("playwright"); } catch {
    return require(resolve(execSync("npm root -g").toString().trim(), "playwright"));
  }
}

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const here = dirname(fileURLToPath(import.meta.url));
const deckFile = resolve(here, "..", "index.html");
const out = resolve(args.out || "tour.mp4");
const fps = Number(args.fps || 30);
const [width, height] = String(args.size || "1280x720").split("x").map(Number);
const scale = Number(args.scale || 1.5);

const query = new URLSearchParams({ capture: "1" });
if (args.bend) query.set("bend", args.bend);
if (args.cards) query.set("cards", args.cards);
if (args.skin) query.set("skin", args.skin);
if (args.motion) query.set("motion", args.motion);

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height }, deviceScaleFactor: scale, colorScheme: args.dark ? "dark" : "light",
});
page.on("pageerror", e => console.error("page error:", e.message));
await page.goto(`${pathToFileURL(deckFile)}?${query}`);
await page.waitForFunction(() => window.pathway);
await page.evaluate(() => window.pathway.ready);
const duration = await page.evaluate(() => window.pathway.duration);

if (args["frames-at"]) {
  const dir = resolve(args["shots-dir"] || "shots");
  mkdirSync(dir, { recursive: true });
  for (const t of String(args["frames-at"]).split(",").map(Number)) {
    await page.evaluate(t => window.pathway.seek(t), t);
    await page.screenshot({ path: resolve(dir, `t${t.toFixed(2).padStart(6, "0")}.png`) });
  }
  console.log(`duration ${duration.toFixed(2)}s, stills in ${dir}`);
  await browser.close();
  process.exit(0);
}

const frames = Math.ceil(duration * fps);
const ff = spawn("ffmpeg", [
  "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out,
], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => ff.on("close", c => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

const started = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.pathway.seek(t), f / fps);
  const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once("drain", r));
  if (f % fps === 0) process.stdout.write(`\r${(f / fps).toFixed(0)}s / ${duration.toFixed(0)}s`);
}
ff.stdin.end();
await done;
await browser.close();
console.log(`\nwrote ${out}: ${frames} frames, ${duration.toFixed(1)}s, rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
