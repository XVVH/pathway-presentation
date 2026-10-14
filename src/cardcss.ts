// The card's CSS, written from typography.ts so the page sets type exactly as
// the checker estimates it. Everything is in cqw: percent of the card's width,
// so a card looks the same at any size and only the camera decides how big.

import { CARD, DENSITY, TYPE, type Density, type DensitySpec } from "./typography.ts";

const n = (v: number) => String(Math.round(v * 10000) / 10000);
const cqw = (v: number) => `${n(v)}cqw`;

function densityRules(scope: string, d: DensitySpec): string {
  return `
${scope} .md p, ${scope} .md li, ${scope} .md ul, ${scope} .md ol, ${scope} .md blockquote, ${scope} .md table, ${scope} .md hr { font-size: ${cqw(d.body)}; }
${scope} .md p, ${scope} .md li, ${scope} .md td, ${scope} .md th { line-height: ${n(d.lineHeight)}; }
${scope} .md p, ${scope} .md blockquote, ${scope} .md table { margin: 0 0 ${n(d.paragraphGapEm)}em; }
${scope} .md hr { margin: ${n(d.paragraphGapEm)}em 0; }
${scope} .md ul, ${scope} .md ol { padding-left: ${n(d.listIndentEm)}em; }
${scope} .md li { margin-bottom: ${n(d.itemGapEm)}em; }
${scope} .md blockquote { padding-left: ${n(d.listIndentEm - 0.25)}em; }
${scope} .md td, ${scope} .md th { padding: ${n(((d.lineHeight * 1.25 - d.lineHeight) / 2))}em 0.6em; }
${scope} .md pre { margin: ${n(d.codeMarginTopEm)}em 0 0; padding: ${cqw(d.codePadY)} ${cqw(d.codePadX)}; font-size: ${cqw(d.code)}; line-height: ${n(d.codeLineHeight)}; }
${scope} .md blockquote p { margin: 0; }
${scope} .md blockquote p + p { margin-top: ${n(d.paragraphGapEm)}em; }
${scope} .md > :last-child { margin-bottom: 0; }`;
}

export function cardCss(): string {
  const e = TYPE.eyebrow, t = TYPE.title, r = TYPE.rootTitle, c = TYPE.caption;
  const densities = (Object.keys(DENSITY) as Density[]).map(k => densityRules(k === "talk" ? ".card" : `.card.d-${k}`, DENSITY[k])).join("\n");
  return `/* Generated from src/typography.ts. */
.card .read {
  position: absolute; inset: 0; box-sizing: border-box; padding: ${cqw(CARD.padTop)} ${cqw(CARD.padX)} ${cqw(CARD.padBottom)};
  display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto auto; align-content: center; column-gap: ${cqw(CARD.columnGap)};
}
.card.has-media:not(.wide-media) .read { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto auto auto; }
.card.has-media:not(.wide-media) .figs { grid-column: 2; grid-row: 1 / span 3; align-self: center; }
.card.wide-media .figs { grid-row: 4; }
.card.wide-media figure { margin-top: ${cqw(TYPE.wideMedia.marginTop)}; }
.card.wide-media figure img { max-height: ${cqw(TYPE.wideMedia.maxHeight)}; object-fit: contain; }
.card .eyebrow { font-size: ${cqw(e.size)}; line-height: ${n(e.lineHeight)}; margin-bottom: ${cqw(e.marginBottom)}; gap: 1.6cqw; }
.card .eyebrow .tag { padding: 0.2cqw 0.7cqw; border-radius: 0.5cqw; }
.card h1, .card h2 { line-height: ${n(t.lineHeight)}; }
.card h2 { font-size: ${cqw(t.size)}; margin: 0 0 ${cqw(t.marginBottom)}; letter-spacing: ${n(t.letterSpacing)}em; }
.card.root h1 { font-size: ${cqw(r.size)}; margin: 0 0 ${cqw(r.marginBottom)}; letter-spacing: ${n(r.letterSpacing)}em; line-height: ${n(r.lineHeight)}; }
.card .md code { font-size: ${n(TYPE.inlineCodeScale)}em; }
.card .md pre code { font-size: inherit; }
.card figcaption { font-size: ${cqw(c.size)}; line-height: ${n(c.lineHeight)}; margin-top: ${n(c.marginTopEm)}em; letter-spacing: ${n(c.letterSpacing)}em; }
.card figure img, .card figure video, .card figure .missing { border-radius: 0.8cqw; }
.card .md pre { border-radius: 0.8cqw; }
${densities}
.card.root .md > p:first-child { font-size: ${cqw(TYPE.rootLede.size)}; }
`;
}
