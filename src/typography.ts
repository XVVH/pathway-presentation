// The card's type scale and spacing, in percent of card width (CSS cqw), plus
// each density's reading limits and each skin's fonts. This is the single source
// of truth: the checker estimates layout from it, and the renderer must set
// cards with exactly these values.

export type Density = "talk" | "technical";
export const DENSITIES: readonly Density[] = ["talk", "technical"];

export const CARD = {
  padTop: 6,
  padBottom: 6,
  padX: 6.5,
  columnGap: 4.5,
  /** Card height is fitted to content in steps of this fraction of the width... */
  ratioStep: 1 / 16,
  /** ...never shorter than this... */
  ratioMin: 0.375,
  /** ...and never taller than this. More content than this is an error. */
  ratioMax: 0.8,
  /** The reference width cards are measured at, in px. Type scales with the card. */
  referenceWidth: 1280,
} as const;

export const TYPE = {
  /** The "Detour" tag adds its padding and dashed border to the eyebrow line. */
  eyebrow: { size: 1.75, lineHeight: 1.2, marginBottom: 2.2, tagExtra: 0.56 },
  title: { size: 6.6, lineHeight: 1.02, marginBottom: 2.6, letterSpacing: 0.01 },
  rootTitle: { size: 16, lineHeight: 1.02, marginBottom: 3, letterSpacing: 0.02 },
  /** The first paragraph on the title card is set larger, as a lede. */
  rootLede: { size: 4.2 },
  caption: { size: 1.6, lineHeight: 1.4, marginTopEm: 0.8, letterSpacing: 0.04 },
  /** Media below the text spans the full width but is capped in height. */
  wideMedia: { marginTop: 3, maxHeight: 16 },
  /** Inline code is set slightly smaller than the text around it. */
  inlineCodeScale: 0.86,
} as const;

export interface DensitySpec {
  /** Body text size, cqw. */
  body: number;
  lineHeight: number;
  paragraphGapEm: number;
  itemGapEm: number;
  listIndentEm: number;
  /** Code block text size, cqw. */
  code: number;
  codeLineHeight: number;
  codePadY: number;
  codePadX: number;
  codeMarginTopEm: number;
  /** Above these, a stop is more than an audience can read while listening. */
  warn: { words: number; bullets: number; codeLines: number; media: number };
}

export const DENSITY: Record<Density, DensitySpec> = {
  talk: {
    body: 3.3, lineHeight: 1.4, paragraphGapEm: 0.6, itemGapEm: 0.4, listIndentEm: 1.2,
    code: 2.15, codeLineHeight: 1.5, codePadY: 2.2, codePadX: 2.6, codeMarginTopEm: 0.4,
    warn: { words: 40, bullets: 5, codeLines: 8, media: 1 },
  },
  technical: {
    body: 2.6, lineHeight: 1.4, paragraphGapEm: 0.6, itemGapEm: 0.4, listIndentEm: 1.2,
    code: 1.75, codeLineHeight: 1.5, codePadY: 2.2, codePadX: 2.6, codeMarginTopEm: 0.4,
    warn: { words: 160, bullets: 8, codeLines: 12, media: 1 },
  },
};

export interface SkinFonts {
  body: string;
  strong: string;
  display: string;
  displayUppercase: boolean;
  mono: string;
  /** How hard the trails bend on this skin's map. */
  bend: "gentle" | "bold" | "winding";
}

/** Keys refer to the face tables in metrics.ts. */
export const SKINS: Record<string, SkinFonts> = {
  sectional: { body: "barlow400", strong: "barlow600", display: "barlowCondensed600", displayUppercase: true, mono: "plexMono400", bend: "bold" },
  boardroom: { body: "plexSans400", strong: "plexSans600", display: "plexSans600", displayUppercase: false, mono: "plexMono400", bend: "gentle" },
};
export const DEFAULT_SKIN = "sectional";
