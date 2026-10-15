// Skins: a built-in one by name, or your own CSS file. Your file starts from a
// built-in skin (--base-skin) and overrides what it likes: colours, motion,
// terrain, curves, and fonts. Fonts are read straight from their files, so the
// checker sizes cards for a brand font as accurately as for the built-in ones.

import { readFont } from "./fontfile.ts";
import type { Io } from "./io.ts";
import { FACE_WIDTHS } from "./metrics.ts";
import type { Diagnostic } from "./model.ts";
import { DEFAULT_SKIN, SKINS, type SkinFonts } from "./typography.ts";

export type Bend = SkinFonts["bend"];
const BENDS: Bend[] = ["gentle", "bold", "winding"];

/** Advance widths per text role, in em, for printable ASCII. */
export interface SkinMetrics {
  body: readonly number[];
  strong: readonly number[];
  display: readonly number[];
  mono: readonly number[];
  displayUppercase: boolean;
}

export interface SkinFace {
  family: string;
  /** The weights the face covers: one weight, or a range for a variable font. */
  weights: [number, number];
  italic: boolean;
  /** The url as written in the CSS. */
  src: string;
  /** The file, resolved from the skin's folder. Null for a url that isn't a file. */
  path: string | null;
}

export interface ResolvedSkin {
  /** The built-in skin's name, or the skin file's path as written in the deck. */
  name: string;
  /** The built-in skin it starts from. */
  base: string;
  /** Your skin file, resolved; null for a built-in skin. */
  file: string | null;
  /** Your skin file's CSS, which comes after the base skin's. */
  css: string | null;
  faces: SkinFace[];
  metrics: SkinMetrics;
  bend: Bend;
  diagnostics: Diagnostic[];
}

export function builtinMetrics(name: string): SkinMetrics {
  const s = SKINS[name] ?? SKINS[DEFAULT_SKIN];
  return { body: FACE_WIDTHS[s.body], strong: FACE_WIDTHS[s.strong], display: FACE_WIDTHS[s.display], mono: FACE_WIDTHS[s.mono], displayUppercase: s.displayUppercase };
}

/** Families each built-in skin loads, which a skin starting from it can use without its own @font-face. */
const BASE_FAMILIES: Record<string, string[]> = {
  sectional: ["barlow", "barlow condensed", "ibm plex mono"],
  boardroom: ["ibm plex sans", "ibm plex mono"],
};

/** Faces the built-in skins ship, by family and weight. */
const BUILTIN_FACES: Record<string, string> = {
  "barlow|400": "barlow400", "barlow|600": "barlow600", "barlow condensed|600": "barlowCondensed600",
  "ibm plex sans|400": "plexSans400", "ibm plex sans|600": "plexSans600", "ibm plex mono|400": "plexMono400",
};

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
/** The first family in a font-family list. */
const firstFamily = (value: string) => unquote(value.split(",")[0] ?? "");

function parseWeight(v: string | undefined): [number, number] {
  const words = (v ?? "400").trim().toLowerCase().split(/\s+/).map(w => (w === "normal" ? 400 : w === "bold" ? 700 : Number(w)));
  const [a, b] = [words[0], words[1] ?? words[0]];
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : [400, 400];
}

/** The face a browser picks for a weight, following CSS font matching. */
export function matchFace(faces: readonly SkinFace[], family: string, weight: number): SkinFace | null {
  const own = faces.filter(f => !f.italic && f.family.toLowerCase() === family.toLowerCase());
  const exact = own.find(f => f.weights[0] <= weight && weight <= f.weights[1]);
  if (exact) return exact;
  const lo = (f: SkinFace) => f.weights[0], hi = (f: SkinFace) => f.weights[1];
  const above = own.filter(f => lo(f) > weight).sort((a, b) => lo(a) - lo(b));
  const below = own.filter(f => hi(f) < weight).sort((a, b) => hi(b) - hi(a));
  if (weight > 500) return above[0] ?? below[0] ?? null;
  if (weight < 400) return below[0] ?? above[0] ?? null;
  // 400 to 500: up to 500 first, then lighter, then heavier.
  return above.find(f => lo(f) <= 500) ?? below[0] ?? above[0] ?? null;
}

export function parseSkinCss(css: string): { props: Map<string, string>; faces: Omit<SkinFace, "path">[] } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const props = new Map<string, string>();
  // The first value of each property is the light, default one.
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) if (!props.has(m[1])) props.set(m[1], m[2].trim());
  const faces: Omit<SkinFace, "path">[] = [];
  for (const block of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const get = (p: string) => new RegExp(`(?:^|;|\\s)${p}\\s*:\\s*([^;]+)`, "i").exec(block[1])?.[1].trim();
    const src = /url\(\s*(["']?)([^"')]+)\1\s*\)/.exec(get("src") ?? "")?.[2];
    const family = get("font-family");
    if (!src || !family) continue;
    faces.push({ family: unquote(family), weights: parseWeight(get("font-weight")), italic: /italic|oblique/i.test(get("font-style") ?? ""), src });
  }
  return { props, faces };
}

export function resolveSkin(spec: string, deckFile: string, io: Io, line = 1): ResolvedSkin {
  if (SKINS[spec]) return { name: spec, base: spec, file: null, css: null, faces: [], metrics: builtinMetrics(spec), bend: SKINS[spec].bend, diagnostics: [] };

  const diagnostics: Diagnostic[] = [];
  const diag = (code: string, severity: Diagnostic["severity"], message: string) => {
    if (!diagnostics.some(d => d.code === code && d.message === message)) diagnostics.push({ code, severity, file: deckFile, line, message });
  };
  const file = io.join(io.dirname(deckFile), spec);
  const css = io.read(file);
  const fallback = (base: string): ResolvedSkin => ({ name: spec, base, file: null, css: null, faces: [], metrics: builtinMetrics(base), bend: SKINS[base].bend, diagnostics });
  if (css === null) {
    diag("skin-not-found", "error", `The skin file '${spec}' doesn't exist. Give its path from the deck's folder, or use a built-in skin: ${Object.keys(SKINS).join(", ")}.`);
    return fallback(DEFAULT_SKIN);
  }

  const { props, faces: written } = parseSkinCss(css);
  let base = props.get("--base-skin") ?? DEFAULT_SKIN;
  if (!SKINS[base]) {
    diag("skin-base-unknown", "warning", `'${spec}' starts from '${base}', which isn't a built-in skin (${Object.keys(SKINS).join(", ")}). Starting from ${DEFAULT_SKIN}.`);
    base = DEFAULT_SKIN;
  }
  const skinDir = io.dirname(file);
  const faces: SkinFace[] = written.map(f => ({ ...f, path: /^[a-z][a-z0-9+.-]+:/i.test(f.src) ? null : io.join(skinDir, f.src) }));
  for (const f of faces) {
    if (!f.path) diag("skin-font-missing", "error", `'${spec}' loads '${f.src}' from the web, which a deck never does. Put the font file in the skin's folder and point at it there.`);
    else if (!io.exists(f.path)) diag("skin-font-missing", "error", `'${spec}' uses the font file '${f.src}', which doesn't exist next to the skin.`);
  }

  // Widths for each role: from the skin's own font files, from a built-in face, or the base skin's.
  const baseMetrics = builtinMetrics(base);
  const read = new Map<string, number[] | null>();
  const widthsOf = (face: SkinFace): number[] | null => {
    if (!face.path || !io.exists(face.path)) return null;
    if (!read.has(face.path)) {
      try {
        const info = readFont(io.head(face.path, 64 * 1024 * 1024) ?? new Uint8Array());
        if (info.variable) diag("skin-font-variable", "info", `'${face.src}' is a variable font. Card sizes use the widths of its default weight, so check bold text with pathway render.`);
        read.set(face.path, info.widths);
      } catch (e) {
        diag("skin-font-unreadable", "warning", `Can't read the widths in '${face.src}': ${(e as Error).message}. Card sizes are estimated with ${base}'s fonts instead.`);
        read.set(face.path, null);
      }
    }
    return read.get(face.path)!;
  };
  const role = (prop: string, weight: number, fallback: readonly number[]): readonly number[] => {
    const value = props.get(prop);
    if (!value) return fallback;
    const family = firstFamily(value);
    const face = matchFace(faces, family, weight);
    if (face) return widthsOf(face) ?? fallback;
    const builtin = BUILTIN_FACES[`${family.toLowerCase()}|${weight}`];
    if (builtin && BASE_FAMILIES[base]?.includes(family.toLowerCase())) return FACE_WIDTHS[builtin];
    diag("skin-font-unmeasured", "warning", `'${spec}' sets ${prop} to '${family}', which has no @font-face in the skin, so Pathway can't measure it and the audience may not have it. Add the font file with @font-face.`);
    return fallback;
  };
  const caseValue = props.get("--display-case");
  const metrics: SkinMetrics = {
    body: role("--font-body", 400, baseMetrics.body),
    strong: role("--font-body", 600, baseMetrics.strong),
    display: role("--font-display", 600, baseMetrics.display),
    mono: role("--font-mono", 400, baseMetrics.mono),
    displayUppercase: caseValue ? /uppercase/i.test(caseValue) : baseMetrics.displayUppercase,
  };
  const bendValue = props.get("--bend") as Bend | undefined;
  if (bendValue && !BENDS.includes(bendValue)) diag("skin-bend-unknown", "warning", `--bend is '${bendValue}'. Use ${BENDS.join(", ")}.`);
  const bend = bendValue && BENDS.includes(bendValue) ? bendValue : SKINS[base].bend;
  return { name: spec, base, file, css, faces, metrics, bend, diagnostics };
}

/** A starting point for your own skin: the base skin's colours and settings, ready to change. */
export function starterSkin(baseCss: string, base: string): string {
  const body = baseCss
    .replace(/^\/\*[\s\S]*?\*\/\s*/, "")
    .replace(/@font-face\s*\{[^}]*\}\s*/g, "")
    .replace(/:root \{\n/, `:root {\n  /* Everything this file doesn't set comes from the built-in ${base} skin. */\n  --base-skin: ${base};\n  /* How hard the trails bend: gentle, bold or winding. */\n  --bend: ${SKINS[base].bend};\n`)
    .trim();
  return `/* A Pathway skin. Use it from a deck with \`skin: path/to/this-file.css\` in the
   frontmatter (the path is from the deck's folder).

   Colours: change the values below, for light and for dark. Delete anything you
   don't change; it comes from the ${base} skin.

   Fonts: put the font files (.woff2, .woff, .ttf or .otf) next to this file,
   declare each weight with @font-face, and name the family in --font-body,
   --font-display or --font-mono. Pathway reads the files to size cards, and
   copies them into every build. Check a font's licence before sharing a build
   outside your organisation. Headings and bold text ask for weight 600; with
   only 400 and 700, the browser uses 700, and so does Pathway. */

/*
@font-face { font-family: "Brand Sans"; src: url("BrandSans-Regular.woff2"); font-weight: 400; }
@font-face { font-family: "Brand Sans"; src: url("BrandSans-Bold.woff2"); font-weight: 700; }
*/

${body}
`;
}
