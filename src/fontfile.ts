// Reads a font file's advance widths, so the checker can size cards for any
// skin's fonts without a browser. Handles TrueType and OpenType (.ttf, .otf),
// WOFF and WOFF2. Widths are in em for printable ASCII, the same table shape
// as metrics.ts, which was measured in a browser: for single characters the
// two agree, since a browser lays out a lone glyph at its advance width.

import { brotliDecompressSync, inflateSync } from "node:zlib";

export interface FontInfo {
  /** Advance widths in em for character codes 32 to 126. */
  widths: number[];
  /** Variable fonts change width with weight; these widths are the default instance's. */
  variable: boolean;
}

type Tables = Map<string, Uint8Array>;

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const i16 = (b: Uint8Array, i: number) => { const v = u16(b, i); return v & 0x8000 ? v - 0x10000 : v; };
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const tag = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

function sfntTables(b: Uint8Array): Tables {
  const tables: Tables = new Map(), n = u16(b, 4);
  for (let k = 0; k < n; k++) {
    const r = 12 + 16 * k, offset = u32(b, r + 8), length = u32(b, r + 12);
    tables.set(tag(b, r), b.subarray(offset, offset + length));
  }
  return tables;
}

function woffTables(b: Uint8Array): Tables {
  const tables: Tables = new Map(), n = u16(b, 12);
  for (let k = 0; k < n; k++) {
    const r = 44 + 20 * k, offset = u32(b, r + 4), compLength = u32(b, r + 8), origLength = u32(b, r + 12);
    const data = b.subarray(offset, offset + compLength);
    tables.set(tag(b, r), compLength < origLength ? new Uint8Array(inflateSync(data)) : data);
  }
  return tables;
}

const WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** WOFF2: one brotli stream of tables. hmtx may be "transformed", which keeps its advance widths and drops side bearings. */
function woff2Tables(b: Uint8Array): { tables: Tables; hmtxTransformed: boolean } {
  const n = u16(b, 12);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let k = 0; k < 5; k++) {
      const byte = b[p++];
      v = v * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return v;
    }
    throw new Error("bad WOFF2 number");
  };
  const dir: { tag: string; length: number; transformed: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    const flags = b[p++];
    const t = (flags & 0x3f) === 0x3f ? tag(b, (p += 4) - 4) : WOFF2_TAGS[flags & 0x3f];
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed unless version 3; every other table only when version isn't 0.
    const transformed = t === "glyf" || t === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    dir.push({ tag: t, length, transformed });
  }
  if (tag(b, 4) === "ttcf") throw new Error("font collections aren't supported");
  const data = new Uint8Array(brotliDecompressSync(b.subarray(p, p + u32(b, 20))));
  const tables: Tables = new Map();
  let at = 0;
  for (const d of dir) { tables.set(d.tag, data.subarray(at, at + d.length)); at += d.length; }
  return { tables, hmtxTransformed: !!dir.find(d => d.tag === "hmtx")?.transformed };
}

/** The glyph a character maps to, from a Unicode cmap subtable (format 4 or 12). */
function glyphFinder(cmap: Uint8Array): (c: number) => number {
  const n = u16(cmap, 2);
  let best: { off: number; format: number } | null = null;
  for (let k = 0; k < n; k++) {
    const platform = u16(cmap, 4 + 8 * k), encoding = u16(cmap, 6 + 8 * k), off = u32(cmap, 8 + 8 * k);
    const format = u16(cmap, off);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (unicode && (format === 4 || format === 12) && (!best || format === 12)) best = { off, format };
  }
  if (!best) throw new Error("no Unicode character map");
  const { off } = best;
  if (best.format === 12) {
    const groups = u32(cmap, off + 12);
    return c => {
      for (let g = 0; g < groups; g++) {
        const r = off + 16 + 12 * g, start = u32(cmap, r), end = u32(cmap, r + 4);
        if (c >= start && c <= end) return u32(cmap, r + 8) + (c - start);
      }
      return 0;
    };
  }
  const segs = u16(cmap, off + 6) / 2;
  const ends = off + 14, starts = ends + 2 * segs + 2, deltas = starts + 2 * segs, ranges = deltas + 2 * segs;
  return c => {
    for (let s = 0; s < segs; s++) {
      if (u16(cmap, ends + 2 * s) < c) continue;
      const start = u16(cmap, starts + 2 * s);
      if (start > c) return 0;
      const delta = i16(cmap, deltas + 2 * s), range = u16(cmap, ranges + 2 * s);
      if (!range) return (c + delta) & 0xffff;
      const g = u16(cmap, ranges + 2 * s + range + 2 * (c - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
}

/** Reads a font's advance widths. Throws with a reason when it can't. */
export function readFont(bytes: Uint8Array): FontInfo {
  const sig = tag(bytes, 0);
  let tables: Tables, hmtxTransformed = false;
  if (sig === "wOF2") ({ tables, hmtxTransformed } = woff2Tables(bytes));
  else if (sig === "wOFF") tables = woffTables(bytes);
  else if (sig === "\0\x01\0\0" || sig === "OTTO" || sig === "true") tables = sfntTables(bytes);
  else throw new Error("not a font file Pathway can read (TrueType, OpenType, WOFF or WOFF2)");
  const head = tables.get("head"), hhea = tables.get("hhea"), hmtx = tables.get("hmtx"), cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmap) throw new Error("the font is missing tables it needs for widths");
  const unitsPerEm = u16(head, 18), metrics = u16(hhea, 34);
  const glyph = glyphFinder(cmap);
  // Transformed WOFF2 hmtx: a flags byte, then the advance widths. Otherwise: (advance, side bearing) pairs.
  const advance = (g: number) => {
    const k = Math.min(g, metrics - 1);
    return hmtxTransformed ? u16(hmtx, 1 + 2 * k) : u16(hmtx, 4 * k);
  };
  const widths: number[] = [];
  for (let c = 32; c < 127; c++) widths.push(Math.round((advance(glyph(c)) / unitsPerEm) * 1000) / 1000);
  return { widths, variable: tables.has("fvar") };
}
