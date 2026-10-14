// The page a deck becomes: one HTML file with the engine, its styles and the
// deck's data inline. Media and fonts sit beside it. A content security policy
// stops the page from reaching the network at all, whatever a deck links to.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cardCss } from "./cardcss.ts";
import { escapeHtml, payloadScript } from "./compile.ts";
import type { Payload } from "./payload.ts";

const here = new URL(".", import.meta.url);
/** Pathway's own files: the bundled engine, its CSS, and the skins with their fonts. */
export const RUNTIME_DIR = new URL("../runtime/", here);
export const SKINS_DIR = new URL("../skins/", here);

export interface Assets {
  js: string;
  css: string;
  /** Font files the skin uses, relative to skins/fonts. */
  fonts: string[];
}

export function loadAssets(skin: string): Assets {
  const skinCss = readFileSync(new URL(`${skin}.css`, SKINS_DIR), "utf8");
  const css = [skinCss, readFileSync(new URL("pathway.css", RUNTIME_DIR), "utf8"), cardCss()].join("\n");
  const js = readFileSync(new URL("pathway.js", RUNTIME_DIR), "utf8");
  const fonts = [...skinCss.matchAll(/url\("fonts\/([^"]+)"\)/g)].map(m => m[1]);
  return { js, css, fonts: [...new Set(fonts)] };
}

export interface PageOptions {
  /** Allow the page to talk back to the server it came from (live reload). */
  connect?: boolean;
}

export function renderPage(payload: Payload, assets: Assets, opts: PageOptions = {}): string {
  // Inline scripts can't contain "</script"; this spelling means the same in JS.
  const js = assets.js.replace(/<\/script/gi, "<\\/script");
  const hash = createHash("sha256").update(js).digest("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${opts.connect ? "'self'" : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html>
<html lang="en" data-skin="${escapeHtml(payload.skin)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="Pathway">
<title>${escapeHtml(payload.title)}</title>
<style>
${assets.css}
</style>
</head>
<body>
<noscript><p style="padding:24px;font:16px/1.5 sans-serif">This talk is a map you travel, and needs JavaScript to draw it.</p></noscript>
<script type="application/json" id="pathway-data">${payloadScript(payload)}</script>
<script>${js}</script>
</body>
</html>
`;
}
