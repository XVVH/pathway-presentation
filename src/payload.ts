// What the compiler hands the browser engine: the deck as data, embedded in the
// page as JSON. Types only, so both sides can import it.

import type { Density, SkinFonts } from "./typography.ts";

export type Bend = SkinFonts["bend"];

/** One place the camera can go: the whole map, a stop, or a look back over a branch. */
export type Target =
  | { kind: "map"; final?: boolean }
  | { kind: "stop"; id: string }
  | { kind: "lookback"; id: string };

export interface PayloadFigure {
  /** "missing" stands in for media the page can't show: remote, absent or unsupported. */
  kind: "image" | "video" | "missing";
  /** URL relative to the page. Empty for missing media. */
  src: string;
  alt: string;
  loop: boolean;
  wide: boolean;
  /** Pixel size of an image, when known, so the page can reserve its space. */
  width?: number;
  height?: number;
  /** For missing media: what was written, and why it isn't shown. */
  note?: string;
}

export interface PayloadStop {
  id: string;
  title: string;
  /** 1 for the title stop, 2 for the trunk, 3 for a branch, and so on. */
  level: number;
  parent: string | null;
  children: string[];
  detour: boolean;
  /** Station number on the default route; null for the title stop and detours. */
  number: number | null;
  /** Card height as a fraction of its width, fixed at build time. */
  ratio: number;
  density: Density;
  /** Words of body text, which sets how long a tour holds here. */
  words: number;
  /** The card's text, as HTML. */
  body: string;
  figures: PayloadFigure[];
}

export interface PayloadRoute {
  name: string;
  targets: Target[];
}

export interface Payload {
  version: 1;
  title: string;
  skin: string;
  bend: Bend;
  stops: PayloadStop[];
  /** Reading order, with pull-backs after branches. */
  route: Target[];
  /** The deck's named routes, in the order the frontmatter lists them. */
  routes: PayloadRoute[];
  /** Speaker notes as HTML by stop id. Null when the build leaves them out. */
  notes: Record<string, string> | null;
  /** True when served by `pathway present`, which reloads the page on changes. */
  dev: boolean;
  /** For `pathway present`: what the checker found, shown over the deck. */
  problems?: { severity: "error" | "warning"; line: number; message: string }[];
}
