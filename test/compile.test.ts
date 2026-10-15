import assert from "node:assert/strict";
import { test } from "node:test";
import { cardCss } from "../src/cardcss.ts";
import { checkDeck } from "../src/check.ts";
import { compileDeck, payloadScript } from "../src/compile.ts";
import { renderBody } from "../src/html.ts";
import { memoryIo } from "../src/io.ts";
import { nodeIo } from "../src/io-node.ts";
import { loadAssets, renderPage } from "../src/page.ts";
import { CARD, DENSITY, TYPE } from "../src/typography.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58]);
const titles = new Map([["intake", "Intake"]]);
const compile = (deck: string, files: Record<string, string | Uint8Array> = {}, opts = {}) => {
  const io = memoryIo({ "talk/deck.md": deck, ...files });
  return compileDeck(checkDeck("talk/deck.md", io), io, opts);
};

test("html: raw HTML and inline images are dropped, text is escaped", () => {
  const html = renderBody("Hello <b>there</b> & ![x](a.png) **bold** `a<b`\n\n<div>block</div>", { titles });
  assert.equal(html, "<p>Hello there &amp;  <strong>bold</strong> <code>a&lt;b</code></p>");
});

test("html: [[links]] become stop links, with the stop's title when unlabelled", () => {
  assert.equal(renderBody("See [[intake]] and [[intake|the funnel]].", { titles }),
    '<p>See <a class="stop-link" href="#intake" data-stop="intake">Intake</a> and <a class="stop-link" href="#intake" data-stop="intake">the funnel</a>.</p>');
  assert.match(renderBody("[[nowhere]]", { titles }), /<span class="stop-link broken">nowhere<\/span>/);
});

test("html: web links open apart from the deck; script links aren't links", () => {
  assert.match(renderBody("[site](https://example.com)", { titles }), /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">site<\/a>/);
  assert.doesNotMatch(renderBody("[x](javascript:alert(1))", { titles }), /href/);
});

test("html: figures are left out of the text, and markdown code keeps its headings marked", () => {
  assert.equal(renderBody("Text.\n\n![A](a.png){.wide}\n", { titles }), "<p>Text.</p>");
  assert.match(renderBody("```markdown\n## Hi\n<b>\n```", { titles }), /<span class="kw">## Hi<\/span>\n&lt;b&gt;/);
});

test("compile: numbers follow the route, ratios come from the estimate, levels from depth", () => {
  const r = checkDeck("examples/pathway/pathway.md", nodeIo);
  const { payload, media } = compileDeck(r, nodeIo);
  const byId = new Map(payload.stops.map(s => [s.id, s]));
  assert.equal(byId.get("pathway")!.number, null);
  assert.equal(byId.get("corridors")!.number, 1);
  assert.equal(byId.get("prezi")!.number, 2);
  assert.equal(byId.get("powerpoint")!.number, null, "detours aren't numbered");
  assert.equal(byId.get("corridors")!.ratio, r.estimates.get("corridors")!.fitted);
  assert.equal(byId.get("detours")!.level, 4);
  assert.deepEqual(media, ["media/flight.mp4", "media/grammar.svg"]);
  assert.equal(payload.bend, "bold");
  assert.equal(payload.notes, null, "notes stay out unless asked for");
  assert.deepEqual(payload.routes.map(x => x.name), ["exec", "format-only"]);
  assert.deepEqual(payload.routes[0].targets.slice(0, 3), [{ kind: "map" }, { kind: "stop", id: "pathway" }, { kind: "stop", id: "corridors" }]);
  assert.deepEqual(payload.routes[0].targets.at(-1), { kind: "map", final: true });
});

test("compile: notes are included only when asked, as HTML by stop id", () => {
  const { payload } = compileDeck(checkDeck("examples/pathway/pathway.md", nodeIo), nodeIo, { notes: true });
  assert.equal(Object.keys(payload.notes!).length, 12);
  assert.match(payload.notes!.corridors, /^<p>Ask the room/);
});

test("compile: media the page can't load becomes a placeholder, never a network request", () => {
  const deck = "# T\n\n## A\n![one](media/a.png)\n\n## B\n![two](https://example.com/b.png)\n\n## C\n![three](../c.png)\n\n## D\n![four](media/gone.png)\n";
  const { payload, media } = compile(deck, { "talk/media/a.png": PNG, "c.png": PNG });
  const figs = payload.stops.slice(1).map(s => s.figures[0]);
  assert.deepEqual(figs.map(f => f.kind), ["image", "missing", "missing", "missing"]);
  assert.equal(figs[0].src, "media/a.png");
  assert.deepEqual([figs[0].width, figs[0].height], [800, 600]);
  assert.deepEqual(figs.slice(1).map(f => f.src), ["", "", ""]);
  assert.match(figs[1].note!, /network/);
  assert.deepEqual(media, ["media/a.png"]);
});

test("payload JSON can't close its script element", () => {
  const { payload } = compile("---\ntitle: \"</script><script>alert(1)</script>\"\n---\n# T\n\n## A\nx\n");
  const json = payloadScript(payload);
  assert.doesNotMatch(json, /<\/script/i);
  assert.equal(JSON.parse(json).title, "</script><script>alert(1)</script>");
});

test("card CSS is written from typography.ts", () => {
  const css = cardCss();
  assert.match(css, new RegExp(`padding: ${CARD.padTop}cqw ${CARD.padX}cqw ${CARD.padBottom}cqw`));
  assert.match(css, new RegExp(`\\.card h2 \\{ font-size: ${TYPE.title.size}cqw`));
  assert.match(css, new RegExp(`\\.card \\.md p, [^{]*\\{ font-size: ${DENSITY.talk.body}cqw`));
  assert.match(css, new RegExp(`\\.card\\.d-technical \\.md p, [^{]*\\{ font-size: ${DENSITY.technical.body}cqw`));
});

test("page: one self-contained file whose policy blocks the network", () => {
  const r = checkDeck("examples/pathway/pathway.md", nodeIo);
  const html = renderPage(compileDeck(r, nodeIo).payload, loadAssets(r.skin));
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(csp, /https?:|\*/);
  // Nothing loads from elsewhere.
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
  assert.doesNotMatch(html, /url\((["']?)(https?:)?\/\//);
  assert.doesNotMatch(html, /@import/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});
