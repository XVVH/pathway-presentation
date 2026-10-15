import type { Density } from "./typography.ts";

export type Severity = "error" | "warning" | "info";

/** Replace lines [startLine, endLine) of a file (1-based; equal lines insert). */
export interface Edit {
  file: string;
  startLine: number;
  endLine: number;
  newText: string;
}

export interface Fix {
  description: string;
  /** Safe fixes are applied by `pathway check --fix`; the rest are proposals. */
  safe: boolean;
  edits?: Edit[];
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  file: string;
  line: number;
  column?: number;
  /** Id of the stop the diagnostic is about, when there is one. */
  stop?: string;
  fix?: Fix;
}

/** A run of inline text with one style, used to estimate how text wraps. */
export interface Run {
  text: string;
  style: "normal" | "strong" | "code";
}

export interface MediaRef {
  src: string;
  alt: string;
  kind: "image" | "video" | "unknown";
  classes: string[];
  attrs: Record<string, string | true>;
  line: number;
  /** True for http(s) and other URLs that need a network. */
  remote: boolean;
  /** True when the media sits inside text rather than on a line of its own. */
  inline: boolean;
}

export interface WikiLink {
  target: string;
  label: string | null;
  line: number;
  column: number;
}

export interface ListItem {
  line: number;
  runs: Run[];
  text: string;
  words: number;
  /** Bold phrase the item opens with ("**Intake:** ..."), if any. */
  leadIn: string | null;
  /** The item's text after the lead-in. */
  rest: string;
  /** 0 for top-level items, 1 for items in a nested list, and so on. */
  depth: number;
}

export type Block =
  | { kind: "paragraph"; line: number; endLine: number; runs: Run[]; text: string; words: number }
  | { kind: "list"; line: number; endLine: number; ordered: boolean; items: ListItem[] }
  | { kind: "code"; line: number; endLine: number; lang: string; lines: string[] }
  | { kind: "quote"; line: number; endLine: number; runs: Run[]; text: string; words: number; paragraphs: Run[][] }
  | { kind: "table"; line: number; endLine: number; rows: number; text: string; words: number }
  | { kind: "media"; line: number; endLine: number; media: MediaRef }
  | { kind: "html"; line: number; endLine: number }
  | { kind: "rule"; line: number; endLine: number };

export interface Stop {
  id: string;
  /** True when the id came from {#id} rather than the title. */
  idExplicit: boolean;
  title: string;
  /** Heading level as written (1 for #). */
  level: number;
  /** Distance from the title stop: 0 for the title, 1 for the trunk, 2 for a branch... */
  depth: number;
  /** Line of the heading. */
  line: number;
  /** Last line of the stop's own body, before the next heading. */
  endLine: number;
  classes: string[];
  attrs: Record<string, string | true>;
  detour: boolean;
  /** Density set on this stop; null means it inherits the deck's. */
  density: Density | null;
  parent: string | null;
  children: string[];
  blocks: Block[];
  links: WikiLink[];
  media: MediaRef[];
  /** Words of body text: paragraphs, list items, quotes and tables. */
  words: number;
  /** Speaker notes written in the stop, as `::: notes` blocks. Never shown on the card. */
  notes: InlineNotes[];
}

export interface InlineNotes {
  /** The `::: notes` line. */
  line: number;
  /** The closing `:::` line, or the last line of notes when it's missing. */
  endLine: number;
  closed: boolean;
  words: number;
}

export interface NamedRoute {
  name: string;
  line: number;
  stops: { id: string; line: number }[];
}

export interface DeckMeta {
  title?: string;
  skin: string;
  density: Density;
  routes: NamedRoute[];
  notes?: string;
  raw: Record<string, unknown>;
}

export interface Deck {
  file: string;
  lines: string[];
  meta: DeckMeta;
  stops: Stop[];
  byId: Map<string, Stop>;
  root: Stop | null;
  diagnostics: Diagnostic[];
}

export interface NotesSection {
  /** The {#id} from the heading if it has one, otherwise the title's slug. */
  id: string;
  /** True when the heading names its stop with {#id}; otherwise it matches by title. */
  explicitId: boolean;
  /** Set by the checker when the section belongs to a stop; its id is then that stop's. */
  matched: boolean;
  title: string;
  /** Line of the heading. */
  line: number;
  /** Last line of the section, before the next heading. */
  endLine: number;
  words: number;
}

export interface Notes {
  file: string;
  sections: NotesSection[];
  diagnostics: Diagnostic[];
}
