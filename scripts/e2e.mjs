// Drives a built deck in a real browser: presenting, the presenter window, named
// routes, recovering from a reload, the strip map on a phone, the tour, and the
// dark theme. Fails on any console error or any request that leaves the machine.
//
//   node scripts/e2e.mjs [--shots <dir>]      (needs the playwright package)

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDeck } from "../src/build.ts";
import { present } from "../src/serve.ts";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require(resolve(execSync("npm root -g").toString().trim(), "playwright")); } })();
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), "pathway-e2e-"));
const built = buildDeck("examples/pathway/pathway.md", { out: join(tmp, "deck"), withNotes: true });
const url = pathToFileURL(join(built.out, "index.html")).href;

const problems = [];
const watch = (page, name) => {
  page.on("console", m => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); });
  page.on("pageerror", e => problems.push(`${name} error: ${e.message}`));
  // Files, inline data, and the local `pathway present` server are all that may be loaded.
  page.on("request", r => { if (!/^((file|data|blob|about):|http:\/\/127\.0\.0\.1:\d+\/)/.test(r.url())) problems.push(`${name} network: ${r.url()}`); });
};
let failed = 0;
const step = async (name, f) => {
  try { await f(); console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split("\n")[0]}`); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); };
const settle = page => page.waitForTimeout(3800);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const deck = await context.newPage();
watch(deck, "deck");
await deck.goto(url);
await deck.evaluate(() => document.fonts.ready);
const status = () => deck.locator("#status").innerText();
const crumbs = () => deck.locator("#crumbs").innerText();

await step("opens on the whole map with the legend", async () => {
  expect(await deck.locator("#help").isVisible(), "legend not shown");
  expect(/WHOLE MAP/i.test(await crumbs()), `crumbs: ${await crumbs()}`);
  await shot(deck, "01-legend");
});

await step("Start goes to the title, → walks the route", async () => {
  await deck.click("#btn-start");
  await settle(deck);
  expect(/^PATHWAY$/i.test((await crumbs()).trim()), `crumbs: ${await crumbs()}`);
  await deck.keyboard.press("ArrowRight");
  await settle(deck);
  expect(/STOP 01/i.test(await status()), `status: ${await status()}`);
  await shot(deck, "02-stop1");
});

let presenter;
await step("P opens the presenter window, which links and shows notes", async () => {
  [presenter] = await Promise.all([context.waitForEvent("page"), deck.keyboard.press("p")]);
  watch(presenter, "presenter");
  await presenter.waitForLoadState();
  await presenter.waitForFunction(() => document.getElementById("p-link")?.textContent === "Linked to the deck", null, { timeout: 5000 });
  const title = await presenter.locator("#p-title").innerText();
  expect(/corridors/i.test(title), `presenter title: ${title}`);
  expect(/Ask the room/.test(await presenter.locator("#p-notes").innerText()), "notes missing");
  expect(/Prezi/i.test(await presenter.locator("#p-next").innerText()), "next stop wrong");
  await shot(presenter, "03-presenter");
});

await step("keys in the presenter window drive the deck", async () => {
  await presenter.bringToFront();
  await presenter.keyboard.press("ArrowRight");
  await settle(deck);
  expect(/STOP 02/i.test(await status()), `deck status: ${await status()}`);
  await presenter.waitForFunction(() => /prezi/i.test(document.getElementById("p-title")?.textContent ?? ""));
});

await step("a detour from the presenter, then → rejoins", async () => {
  const button = presenter.locator("#p-detours button");
  expect(await button.count() === 1, "expected one detour here");
  await button.click();
  await settle(deck);
  expect(/DETOUR 1 OF 1/i.test(await status()), `deck status: ${await status()}`);
  await shot(deck, "04-detour");
  await presenter.keyboard.press("ArrowRight");
  await settle(deck);
  expect(/STOP 03/i.test(await status()), `deck status: ${await status()}`);
});

await step("a click is a look: → comes back, C carries on from there", async () => {
  const walked = () => deck.evaluate(() => JSON.parse(Object.entries(sessionStorage).find(([k]) => k.startsWith("pathway:pos:"))[1]).walked.sort());
  const before = await walked();
  await deck.evaluate(() => { location.hash = "tilt"; });
  await settle(deck);
  expect(/OFF ROUTE/i.test(await status()), `deck status: ${await status()}`);
  expect(JSON.stringify(await walked()) === JSON.stringify(before), `a look lit trails: ${await walked()}`);
  await deck.keyboard.press("ArrowRight");
  await settle(deck);
  expect(/LOOK BACK OVER DECKS ARE CORRIDORS/i.test(await status()), `didn't rejoin: ${await status()}`);
  await deck.evaluate(() => { location.hash = "motion"; });
  await settle(deck);
  expect(/C CARRIES ON/i.test(await status()), `no carry-on hint: ${await status()}`);
  await shot(deck, "04a-peek");
  await shot(presenter, "04b-presenter-peek");
  await presenter.locator("#p-continue").click();
  await settle(deck);
  expect(/STOP 09/i.test(await status()), `deck status: ${await status()}`);
  expect(await presenter.locator("#p-continue").isHidden(), "carry-on button still shown");
  const after = await walked();
  expect(!after.includes("motion") && !after.includes("tilt"), `skipped trails lit: ${after}`);
});

await step("choosing a named route in the presenter", async () => {
  await presenter.selectOption("#p-route", "exec");
  await settle(deck);
  expect(/EXEC/i.test(await status()), `deck status: ${await status()}`);
  await presenter.keyboard.press("ArrowRight");
  await settle(deck);
  const s = await status();
  expect(/EXEC/i.test(s), `deck status: ${s}`);
  await shot(presenter, "05-presenter-route");
});

await step("a reload keeps your place, and the presenter relinks", async () => {
  const before = await crumbs();
  await deck.reload();
  await deck.evaluate(() => document.fonts.ready);
  await deck.waitForTimeout(500);
  expect(await deck.locator("#help").isHidden(), "legend shown after reload");
  expect((await crumbs()) === before, `crumbs ${await crumbs()} != ${before}`);
  await presenter.waitForFunction(() => document.getElementById("p-link")?.textContent === "Linked to the deck", null, { timeout: 6000 });
  await presenter.keyboard.press("ArrowLeft");
  await settle(deck);
});

await step("B blanks the screen, any key brings it back", async () => {
  await deck.bringToFront();
  await deck.keyboard.press("b");
  expect(await deck.locator("#blank").isVisible(), "not blank");
  await deck.keyboard.press("x");
  expect(await deck.locator("#blank").isHidden(), "still blank");
});

await step("the tour plays and scrubs", async () => {
  await deck.keyboard.press("v");
  await deck.waitForTimeout(2500);
  expect(await deck.locator("#scrub").isVisible(), "no scrubber");
  await shot(deck, "06-tour");
  await deck.keyboard.press("Escape");
  await settle(deck);
});

await step("the whole map", async () => {
  await deck.keyboard.press("m");
  await settle(deck);
  expect(!/C CARRIES ON/i.test(await status()), `carry-on offered on the map: ${await status()}`);
  await shot(deck, "07-map");
});

await step("dark theme", async () => {
  await deck.keyboard.press("d");
  await deck.waitForTimeout(400);
  const bg = await deck.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg !== "rgb(237, 240, 234)", `background still light: ${bg}`);
  await shot(deck, "08-dark");
  await deck.keyboard.press("d");
});

await step("a phone gets the strip map, with the landscape a tap away", async () => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  watch(phone, "phone");
  await phone.goto(url);
  await phone.evaluate(() => document.fonts.ready);
  expect(await phone.locator("#strip").isVisible(), "strip not shown");
  await phone.locator("#strip").evaluate(el => el.scrollTo(0, 900));
  await phone.waitForTimeout(400);
  await shot(phone, "09-strip");
  await phone.click("#s-map");
  await phone.waitForTimeout(3500);
  expect(await phone.locator("#stage").isVisible(), "map not shown");
  await shot(phone, "10-strip-map");
  await phone.click("#btn-back");
  await phone.close();
});

await step("pathway present reloads the page when the deck changes, keeping your place", async () => {
  const copy = join(tmp, "live");
  cpSync("examples/pathway", copy, { recursive: true });
  const deckFile = join(copy, "pathway.md");
  const server = await present(deckFile, { port: 0 });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page, "present");
    await page.goto(server.url);
    await page.evaluate(() => document.fonts.ready);
    await page.click("#btn-start");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(3000);
    await page.evaluate(() => { window.__before = true; });
    const reloaded = page.waitForEvent("load");
    writeFileSync(deckFile, readFileSync(deckFile, "utf8").replace("## Decks are corridors {#corridors}", "## Decks are hallways {#corridors}"));
    await reloaded;
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => !window.__before), "page didn't reload");
    const c = await page.locator("#crumbs").innerText();
    expect(/HALLWAYS/i.test(c), `crumbs after reload: ${c}`);
    await page.close();
  } finally {
    await server.close();
  }
});

await step("nothing left the machine and nothing broke", async () => {
  expect(!problems.length, problems.join("\n      "));
});

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
