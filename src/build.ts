// `pathway build`: a deck becomes a folder you can open from disk, copy to a
// USB stick or a share, and present offline. index.html holds the engine and the
// deck; the media the deck uses and the skin's fonts sit beside it.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDeck, type CheckResult } from "./check.ts";
import { compileDeck } from "./compile.ts";
import { nodeIo } from "./io-node.ts";
import { loadAssets, renderPage, SKINS_DIR } from "./page.ts";

export interface BuildOptions {
  /** Output folder. Default: <deck>-build beside the deck. */
  out?: string;
  /** Include speaker notes in the page (for the presenter window). Off by default. */
  withNotes?: boolean;
  /** Notes file, when not the default. */
  notes?: string;
  /** Build even when the deck has errors. */
  force?: boolean;
  /** Where the audience copy will live, for the closing view's QR code. Overrides the deck's `url`. */
  url?: string;
}

export interface BuildResult {
  check: CheckResult;
  /** Null when the deck has errors and the build was refused. */
  out: string | null;
  files: string[];
  /** How many stops' notes went in; null when notes were left out. */
  notes: number | null;
  /** Your skin's own font files, which may not be licensed for sharing outside your organisation. */
  skinFonts: string[];
  /** The address the closing view's QR code points to. */
  url: string | null;
}

const GENERATOR = '<meta name="generator" content="Pathway">';

/** The audience copy goes in <deck>-build; a copy with notes, in <deck>-presenter, so the two never mix. */
export function defaultOutDir(deckPath: string, withNotes = false): string {
  return join(dirname(deckPath), `${basename(deckPath).replace(/\.md$/i, "")}-${withNotes ? "presenter" : "build"}`);
}

/** Only ever delete a folder Pathway built, or an empty one. */
function prepareOut(out: string, deckPath: string): void {
  const abs = resolve(out);
  const fromOut = relative(abs, resolve(dirname(deckPath)));
  if (!fromOut || (!fromOut.startsWith("..") && !isAbsolute(fromOut))) throw new Error(`Won't build into ${out}: it holds the deck itself.`);
  if (existsSync(abs)) {
    const entries = readdirSync(abs);
    const index = join(abs, "index.html");
    const ours = existsSync(index) && readFileSync(index, "utf8").includes(GENERATOR);
    if (entries.length && !ours) throw new Error(`${out} already exists and isn't a Pathway build. Choose another folder with --out.`);
    rmSync(abs, { recursive: true, force: true });
  }
  mkdirSync(abs, { recursive: true });
}

export function buildDeck(deckPath: string, opts: BuildOptions = {}): BuildResult {
  const check = checkDeck(deckPath, nodeIo, { notes: opts.withNotes ? opts.notes : null });
  if (check.summary.errors && !opts.force) return { check, out: null, files: [], notes: null, skinFonts: [], url: null };
  const out = opts.out ?? defaultOutDir(deckPath, !!opts.withNotes);
  const { payload, media } = compileDeck(check, nodeIo, { notes: !!opts.withNotes, url: opts.url });
  const assets = loadAssets(check.skin);
  prepareOut(out, deckPath);

  const files: string[] = [];
  const write = (rel: string, data: string | Buffer) => {
    const path = join(out, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    files.push(rel);
  };
  const copy = (from: string, rel: string) => {
    const path = join(out, rel);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(from, path);
    files.push(rel);
  };
  write("index.html", renderPage(payload, assets));
  const deckDir = dirname(deckPath);
  for (const rel of media) copy(join(deckDir, rel), rel);
  for (const f of assets.fonts) copy(f.from, f.to);
  // The built-in fonts' licence travels with them.
  const fontsDir = fileURLToPath(new URL("fonts/", SKINS_DIR));
  if (assets.fonts.some(f => f.builtin)) for (const f of readdirSync(fontsDir).filter(f => f.startsWith("OFL"))) copy(join(fontsDir, f), `fonts/${f}`);
  return {
    check, out, files: files.map(f => f.split(sep).join("/")),
    notes: payload.notes ? Object.keys(payload.notes).length : null,
    url: payload.handoff?.url ?? null,
    skinFonts: assets.fonts.filter(f => !f.builtin).map(f => basename(f.from)),
  };
}

/** A path for messages: relative to the working directory when that's shorter. */
export function displayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel && !rel.startsWith("..") && rel.length < p.length ? rel : p;
}
