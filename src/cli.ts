// The `pathway` command.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { buildDeck, displayPath } from "./build.ts";
import { checkDeck, type CheckResult } from "./check.ts";
import { applyEdits, safeEdits } from "./fix.ts";
import { formatDeck } from "./fmt.ts";
import { checkUrl } from "./frontmatter.ts";
import { planInlineNotes } from "./inline-notes.ts";
import { checkJson, formatCheck, formatOutline, outlineJson } from "./format.ts";
import { nodeIo } from "./io-node.ts";
import { SKINS_DIR } from "./page.ts";
import { starterSkin } from "./skin.ts";
import { plural } from "./text.ts";
import { SKINS } from "./typography.ts";

const HELP = `Usage: pathway <command> <deck.md> [options]

Commands
  check <deck.md>     Find problems: structure, links, media, routes, notes,
                      and stops that hold too much. Exit code 1 if any errors.
  outline <deck.md>   Show the map as a tree, the default route, and named routes.
  present <deck.md>   Present from this machine: serves the deck on 127.0.0.1
                      with your notes in the presenter window (press P), and
                      reloads as you edit.
  build <deck.md>     Make a folder to present from anywhere, offline: open its
                      index.html in a browser. Notes stay out unless asked for.
  fmt <file.md>...    Tidy a deck's layout without changing what it says.
  new-skin <file.css> Start your own skin: colours, fonts and motion, from a
                      built-in skin (--from, default boardroom).
  inline-notes <deck.md>
                      Move a separate notes file into the deck, as ::: notes
                      blocks under each stop. Shows what would move; --write
                      moves it.
  render <deck.md>    Save pictures of stops, as the audience sees them.
                      Needs Playwright.

Options
  --json              check, outline: machine-readable output.
  --notes <file>      Speaker notes file (default: <deck>.notes.md beside the deck).
  --no-notes          Don't read speaker notes.
  --strict            check: exit 1 on warnings as well as errors.
  --fix               check: apply the fixes marked safe, then check again.
  --out <path>        build: the folder to write (default: <deck>-build, or
                      <deck>-presenter with --with-notes).
                      render: a folder, or a .png path for one picture.
  --with-notes        build: include speaker notes, to present from a machine
                      without Node. Anyone with the folder can read them, so
                      never upload it.
  --force             build: build even when the deck has errors.
  --url <address>     build: where the audience copy will live. The closing
                      view shows it as a QR code. Overrides the deck's url.
  --port <n>          present: the port (default 4310; 0 picks a free one).
  --write             fmt: rewrite the files in place. inline-notes: move the notes.
  --check             fmt: exit 1 if any file would change.
  --stop <id>         render: a stop to picture (repeat for more).
  --map               render: the whole map.
  --all               render: the whole map and every stop.
  --size <WxH>        render: picture size in px (default 1280x720).
  --scale <n>         render: pixel density (default 1; 2 for sharper).
  --theme <name>      render: dark or light (default: light).
  --from <skin>       new-skin: the built-in skin to start from.
  -h, --help          Show this help.
  -v, --version       Show the version.
`;

const COMMANDS = ["check", "outline", "present", "build", "fmt", "render", "inline-notes", "new-skin"];

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true,
      options: {
        json: { type: "boolean" }, strict: { type: "boolean" }, fix: { type: "boolean" },
        notes: { type: "string" }, "no-notes": { type: "boolean" },
        out: { type: "string" }, "with-notes": { type: "boolean" }, force: { type: "boolean" }, url: { type: "string" },
        port: { type: "string" }, write: { type: "boolean" }, check: { type: "boolean" },
        stop: { type: "string", multiple: true }, map: { type: "boolean" }, all: { type: "boolean" },
        size: { type: "string" }, scale: { type: "string" }, theme: { type: "string" }, from: { type: "string" },
        help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values: o, positionals } = parsed;
  if (o.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const [command, ...files] = positionals;
  if (o.help || !command || command === "help") { process.stdout.write(HELP); return command || o.help ? 0 : 2; }
  if (!COMMANDS.includes(command)) { process.stderr.write(`Unknown command '${command}'.\n\n${HELP}`); return 2; }
  const usage = (msg: string) => { process.stderr.write(`${msg}\n\n${HELP}`); return 2; };
  if (!files.length) return usage(`${command} needs a file.`);
  if (command !== "fmt" && files.length > 1) return usage(`${command} takes one deck file.`);
  if (command === "new-skin") {
    const [target] = files;
    const base = o.from ?? "boardroom";
    if (!SKINS[base]) return usage(`--from must be a built-in skin: ${Object.keys(SKINS).join(", ")}.`);
    if (!/\.css$/i.test(target)) return usage("A skin is a .css file, like brand.css.");
    if (nodeIo.exists(target)) { process.stderr.write(`${target} already exists. Choose another name, or edit it.\n`); return 1; }
    const baseCss = readFileSync(new URL(`${base}.css`, SKINS_DIR), "utf8");
    mkdirSync(dirname(target) || ".", { recursive: true });
    writeFileSync(target, starterSkin(baseCss, base));
    process.stdout.write(`Wrote ${target}, starting from ${base}. Use it from a deck with \`skin: <path to it>\` in the frontmatter.\n`);
    return 0;
  }
  for (const f of files) if (!nodeIo.exists(f)) { process.stderr.write(`Can't find ${f}.\n`); return 2; }
  const color = !o.json && !!process.stderr.isTTY && !process.env.NO_COLOR;
  const deckPath = files[0];
  const notesOpt = { notes: o["no-notes"] ? null : o.notes };

  switch (command) {
    case "check": case "outline": {
      let result = checkDeck(deckPath, nodeIo, notesOpt);
      const outColor = !o.json && !!process.stdout.isTTY && !process.env.NO_COLOR;
      if (command === "outline") {
        process.stdout.write(o.json ? `${JSON.stringify(outlineJson(result), null, 2)}\n` : `${formatOutline(result, { color: outColor })}\n`);
        return 0;
      }
      if (o.fix) {
        let total = 0;
        for (const [file, edits] of safeEdits(result.diagnostics)) {
          const { text, applied } = applyEdits(readFileSync(file, "utf8"), edits);
          writeFileSync(file, text);
          total += applied;
        }
        if (!o.json) process.stderr.write(`Applied ${plural(total, "fix", "fixes")}.\n`);
        if (total) result = checkDeck(deckPath, nodeIo, notesOpt);
      }
      process.stdout.write(o.json ? `${JSON.stringify(checkJson(result), null, 2)}\n` : `${formatCheck(result, { color: outColor })}\n`);
      return result.summary.errors || (o.strict && result.summary.warnings) ? 1 : 0;
    }

    case "build": {
      const url = o.url === undefined ? undefined : checkUrl(o.url);
      if (url === null) return usage("--url must be a full web address, like https://intranet.example.com/talks/pipelines/.");
      let result;
      try {
        result = buildDeck(deckPath, { out: o.out, withNotes: o["with-notes"], notes: o.notes, force: o.force, url });
      } catch (e) {
        process.stderr.write(`${(e as Error).message}\n`);
        return 1;
      }
      if (!result.out) {
        process.stderr.write(`${formatCheck(result.check, { color })}\n\nNot built: the deck has errors. Fix them, or build anyway with --force.\n`);
        return 1;
      }
      if (result.check.summary.warnings || result.check.summary.errors) process.stderr.write(`${formatCheck(result.check, { color })}\n\n`);
      const media = result.files.filter(f => f !== "index.html" && !f.startsWith("fonts/")).length;
      const where = `${displayPath(result.out)}/index.html (${plural(media, "media file")})`;
      if (!o["with-notes"]) {
        process.stdout.write(`Built the audience copy: ${where}, with no speaker notes.\n`);
        process.stdout.write(result.url
          ? `Upload the folder to ${result.url}; the QR code at the end of the talk points there.\n`
          : "To end the talk on a QR code for it, add `url:` to the deck, or build with --url.\n");
      } else if (result.notes) {
        process.stdout.write(`Built a copy to present from: ${where}, with speaker notes for ${plural(result.notes, "stop")}.\n`);
        process.stderr.write("Anyone with this folder can read the notes, so don't upload it. The audience copy is `pathway build` without --with-notes.\n");
      } else {
        process.stdout.write(`Built ${where}.\n`);
        process.stderr.write("There were no speaker notes to include: none in the deck, and no notes file.\n");
      }
      if (result.skinFonts.length) process.stderr.write(`This build includes your skin's fonts (${result.skinFonts.join(", ")}). Check their licence before sharing it outside your organisation.\n`);
      return 0;
    }

    case "present": {
      const port = o.port === undefined ? 4310 : Number(o.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return usage(`--port must be a number from 0 to 65535.`);
      const { present } = await import("./serve.ts");
      const summary = (r: CheckResult) => {
        const s = r.summary;
        return `${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}`;
      };
      let presenting;
      try {
        presenting = await present(deckPath, {
          port, notes: notesOpt.notes,
          onCheck: (r, reason) => {
            if (reason === "start") { process.stderr.write(`${formatCheck(r, { color })}\n\n`); return; }
            const time = new Date().toTimeString().slice(0, 8);
            process.stderr.write(`${time}  reloaded: ${summary(r)}\n`);
            for (const d of r.diagnostics.filter(d => d.severity === "error")) process.stderr.write(`          ${displayPath(d.file)}:${d.line}  ${d.message}\n`);
          },
        });
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        process.stderr.write(err.code === "EADDRINUSE" ? `Port ${port} is in use. Try --port ${port + 1}, or --port 0 for any free port.\n` : `${err.message}\n`);
        return 1;
      }
      process.stdout.write(`Presenting ${deckPath} at ${presenting.url}\nOpen it in a browser; press P there for the presenter window. Ctrl+C stops.\n`);
      await new Promise<void>(done => {
        const stop = () => { presenting.close().then(done); };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return 0;
    }

    case "fmt": {
      if (o.write && o.check) return usage("Use --write or --check, not both.");
      if (!o.write && !o.check && files.length > 1) return usage("To format several files, use --write or --check.");
      let untidy = 0;
      for (const f of files) {
        const before = readFileSync(f, "utf8"), after = formatDeck(before);
        if (!o.write && !o.check) { process.stdout.write(after); continue; }
        if (after === before) continue;
        untidy++;
        if (o.write) { writeFileSync(f, after); process.stderr.write(`Tidied ${f}\n`); }
        else process.stderr.write(`${f} isn't tidy. Run: pathway fmt --write ${f}\n`);
      }
      return o.check && untidy ? 1 : 0;
    }

    case "inline-notes": {
      const result = checkDeck(deckPath, nodeIo, { notes: o.notes });
      const plan = planInlineNotes(result, nodeIo);
      if (!plan) { process.stderr.write(`There's no notes file to move${o.notes ? ` at ${o.notes}` : " beside the deck"}.\n`); return 1; }
      const notesFile = result.notes!.file;
      const verb = o.write ? "Moved" : "Would move";
      process.stdout.write(`${verb} notes for ${plural(plan.moved.length, "stop")} from ${notesFile} into ${deckPath}.\n`);
      for (const k of plan.kept) process.stdout.write(`  Stays in ${notesFile}: '${k.title}' (line ${k.line}), because ${k.reason}.\n`);
      if (!o.write) { process.stdout.write("Nothing changed yet. Run again with --write to move them.\n"); return 0; }
      writeFileSync(deckPath, plan.deck);
      if (plan.rest === null) { rmSync(notesFile); process.stdout.write(`Removed ${notesFile}: nothing was left in it.\n`); }
      else writeFileSync(notesFile, plan.rest);
      return 0;
    }

    case "render": {
      const size = /^(\d+)x(\d+)$/.exec(o.size ?? "1280x720");
      if (!size) return usage("--size is WIDTHxHEIGHT, like 1920x1080.");
      const scale = Number(o.scale ?? 1);
      if (!(scale > 0 && scale <= 4)) return usage("--scale is a number from 0 to 4.");
      if (o.theme && o.theme !== "dark" && o.theme !== "light") return usage("--theme is dark or light.");
      const check = checkDeck(deckPath, nodeIo, { notes: null });
      const targets = o.all ? ["map", ...check.deck.stops.map(s => s.id)] : [...(o.map ? ["map"] : []), ...(o.stop ?? [])];
      if (!targets.length) return usage("Say what to render: --stop <id>, --map, or --all.");
      const { renderStills } = await import("./render.ts");
      const out = o.out ?? `${deckPath.replace(/\.md$/i, "")}-shots`;
      try {
        const r = await renderStills(deckPath, { targets, out, width: Number(size[1]), height: Number(size[2]), scale, theme: o.theme as "dark" | "light" | undefined });
        for (const id of r.unknown) process.stderr.write(`No stop has the id '${id}'.\n`);
        for (const id of r.overflowing) process.stderr.write(`Warning: '${id}' came out taller than its card.\n`);
        process.stdout.write(`${r.files.map(displayPath).join("\n")}\n`);
        return r.unknown.length ? 1 : 0;
      } catch (e) {
        process.stderr.write(`${(e as Error).message}\n`);
        return 1;
      }
    }
  }
  return 2;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; });
