// Estimates how tall a stop's card is at reading size, without a browser.
// Text wraps word by word using measured advance widths of the skin's fonts;
// spacing follows typography.ts. The renderer measures exactly; this estimate
// is for the checker, and is calibrated against the browser in the tests.

import { FACE_WIDTHS } from "./metrics.ts";
import type { MediaRef, Run, Stop } from "./model.ts";
import { CARD, DENSITY, SKINS, TYPE, type Density } from "./typography.ts";

export interface Estimate {
  /** Card height as a fraction of its width, before snapping. */
  ratio: number;
  /** Height the card gets: snapped to the step and clamped between min and max. */
  fitted: number;
  overflow: boolean;
  /** How many lines of body text over the cap, when it overflows. */
  overflowLines: number;
  layout: "plain" | "side" | "wide";
  /** Code lines too long to show at this width, with their file line numbers. */
  clippedCode: { line: number; length: number; max: number }[];
}

export interface EstimateOptions {
  skin: string;
  density: Density;
  isRoot: boolean;
  /** Height over width for an image, if known. */
  aspect: (media: MediaRef) => number | null;
}

interface Faces { body: readonly number[]; strong: readonly number[]; mono: readonly number[] }

const avgCache = new Map<readonly number[], number>();
function charWidth(face: readonly number[], ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c < 127) return face[c - 32];
  let avg = avgCache.get(face);
  if (avg === undefined) {
    avg = face.slice(97 - 32, 123 - 32).reduce((a, b) => a + b, 0) / 26;
    avgCache.set(face, avg);
  }
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 1 : avg;
}

/** Greedy word wrap, the way browsers break lines. Returns the number of lines. */
export function wrapLines(runs: readonly Run[], maxEm: number, faces: Faces, opts: { uppercase?: boolean; letterSpacing?: number } = {}): number {
  const ls = opts.letterSpacing ?? 0;
  let lines = 0, lineW = 0, wordW = 0, spaceW = 0, inWord = false;
  const flush = () => {
    if (!inWord) return;
    if (lines === 0) { lines = 1; lineW = wordW; }
    else if (lineW + spaceW + wordW <= maxEm + 1e-6) lineW += spaceW + wordW;
    else { lines++; lineW = wordW; }
    wordW = 0; inWord = false;
  };
  for (const run of runs) {
    const face = run.style === "code" ? faces.mono : run.style === "strong" ? faces.strong : faces.body;
    const scale = run.style === "code" ? TYPE.inlineCodeScale : 1;
    for (const raw of run.text) {
      const ch = opts.uppercase ? raw.toUpperCase() : raw;
      if (/\s/.test(ch)) { flush(); spaceW = charWidth(face, " ") * scale + ls; continue; }
      wordW += charWidth(face, ch) * scale + ls;
      inWord = true;
    }
  }
  flush();
  return lines;
}

export function estimateStop(stop: Stop, o: EstimateOptions): Estimate {
  const skin = SKINS[o.skin] ?? SKINS.sectional;
  const faces: Faces = { body: FACE_WIDTHS[skin.body], strong: FACE_WIDTHS[skin.strong], mono: FACE_WIDTHS[skin.mono] };
  const display: Faces = { body: FACE_WIDTHS[skin.display], strong: FACE_WIDTHS[skin.display], mono: faces.mono };
  const monoAdvance = charWidth(faces.mono, "0");
  const d = DENSITY[stop.density ?? o.density];

  const figures = stop.media.filter(m => !m.inline);
  const wide = figures.some(m => m.classes.includes("wide"));
  const side = figures.length > 0 && !wide;
  const contentW = 100 - 2 * CARD.padX;
  const colW = side ? (contentW - CARD.columnGap) / 2 : contentW;

  // Text column: eyebrow, title, then the body blocks.
  let col = 0;
  if (!o.isRoot) col += TYPE.eyebrow.size * TYPE.eyebrow.lineHeight + TYPE.eyebrow.marginBottom + (stop.detour ? TYPE.eyebrow.tagExtra : 0);
  const t = o.isRoot ? TYPE.rootTitle : TYPE.title;
  const titleLines = Math.max(1, wrapLines([{ text: stop.title, style: "normal" }], colW / t.size, display, { uppercase: skin.displayUppercase, letterSpacing: t.letterSpacing }));
  col += titleLines * t.size * t.lineHeight + t.marginBottom;

  const clippedCode: Estimate["clippedCode"] = [];
  const blocks = stop.blocks.filter(b => b.kind !== "media" && b.kind !== "html");
  let pending = 0;
  blocks.forEach((b, i) => {
    const last = i === blocks.length - 1;
    let top = 0, h = 0, bottom = 0;
    if (b.kind === "paragraph" || b.kind === "quote") {
      const size = o.isRoot && i === 0 && b.kind === "paragraph" ? TYPE.rootLede.size : d.body;
      const indent = b.kind === "quote" ? d.listIndentEm * size : 0;
      h = wrapLines(b.runs, (colW - indent) / size, faces) * size * d.lineHeight;
      bottom = last ? 0 : d.paragraphGapEm * size;
    } else if (b.kind === "list") {
      for (const item of b.items) {
        const indent = d.listIndentEm * d.body * (item.depth + 1);
        const n = Math.max(1, wrapLines(item.runs, (colW - indent) / d.body, faces));
        h += n * d.body * d.lineHeight + d.itemGapEm * d.body;
      }
    } else if (b.kind === "code") {
      top = d.codeMarginTopEm * d.code;
      h = b.lines.length * d.code * d.codeLineHeight + 2 * d.codePadY;
      const max = Math.floor((colW - 2 * d.codePadX) / (d.code * monoAdvance));
      b.lines.forEach((text, k) => {
        const length = text.replace(/\t/g, "    ").length;
        if (length > max) clippedCode.push({ line: b.line + 1 + k, length, max });
      });
    } else if (b.kind === "table") {
      h = b.rows * d.body * d.lineHeight * 1.25;
      bottom = last ? 0 : d.paragraphGapEm * d.body;
    } else if (b.kind === "rule") {
      top = bottom = d.paragraphGapEm * d.body;
      h = 0.2;
    }
    // Vertical margins between siblings collapse to the larger one.
    col += (i === 0 ? top : Math.max(pending, top)) + h;
    pending = bottom;
  });

  const figureHeight = (m: MediaRef, width: number) => {
    let h = width * (m.kind === "video" ? 9 / 16 : o.aspect(m) ?? 9 / 16);
    if (wide && m.kind !== "video") h = Math.min(h, TYPE.wideMedia.maxHeight);
    if (m.kind === "video" && m.alt) {
      const c = TYPE.caption;
      const lines = wrapLines([{ text: m.alt, style: "normal" }], width / c.size, { body: faces.mono, strong: faces.mono, mono: faces.mono }, { letterSpacing: c.letterSpacing });
      h += c.marginTopEm * c.size + lines * c.size * c.lineHeight;
    }
    return h;
  };
  let content = col;
  if (side) content = Math.max(col, figures.reduce((a, m) => a + figureHeight(m, colW), 0));
  else if (wide) content = col + figures.reduce((a, m) => a + TYPE.wideMedia.marginTop + figureHeight(m, contentW), 0);

  const ratio = (CARD.padTop + CARD.padBottom + content) / 100;
  const fitted = Math.min(CARD.ratioMax, Math.max(CARD.ratioMin, Math.ceil(ratio / CARD.ratioStep - 1e-3) * CARD.ratioStep));
  const overflow = ratio > CARD.ratioMax + 1e-9;
  const overflowLines = overflow ? Math.ceil(((ratio - CARD.ratioMax) * 100) / (d.body * d.lineHeight)) : 0;
  return { ratio, fitted, overflow, overflowLines, layout: side ? "side" : wide ? "wide" : "plain", clippedCode };
}
