// The `pathway` command.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkDeck } from "./check.ts";
import { applyEdits, safeEdits } from "./fix.ts";
import { checkJson, formatCheck, formatOutline, outlineJson } from "./format.ts";
import { nodeIo } from "./io-node.ts";
import { plural } from "./text.ts";

const HELP = `Usage: pathway <command> <deck.md> [options]

Commands
  check <deck.md>     Find problems: structure, links, media, routes, notes,
                      and stops that hold too much. Exit code 1 if any errors.
  outline <deck.md>   Show the map as a tree, the default route, and named routes.

Options
  --json              Machine-readable output (for agents and scripts).
  --notes <file>      Speaker notes file (default: <deck>.notes.md beside the deck).
  --no-notes          Don't read speaker notes.
  --strict            check: exit 1 on warnings as well as errors.
  --fix               check: apply the fixes marked safe, then check again.
  -h, --help          Show this help.
  -v, --version       Show the version.
`;

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true,
      options: {
        json: { type: "boolean" }, strict: { type: "boolean" }, fix: { type: "boolean" },
        notes: { type: "string" }, "no-notes": { type: "boolean" },
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
  const [command, deckPath, ...extra] = positionals;
  if (o.help || !command || command === "help") { process.stdout.write(HELP); return command || o.help ? 0 : 2; }
  if (!["check", "outline"].includes(command)) { process.stderr.write(`Unknown command '${command}'.\n\n${HELP}`); return 2; }
  if (!deckPath || extra.length) { process.stderr.write(`${command} takes one deck file.\n\n${HELP}`); return 2; }
  if (!nodeIo.exists(deckPath)) { process.stderr.write(`Can't find ${deckPath}.\n`); return 2; }

  const opts = { notes: o["no-notes"] ? null : o.notes };
  const color = !o.json && !!process.stdout.isTTY && !process.env.NO_COLOR;
  let result = checkDeck(deckPath, nodeIo, opts);

  if (command === "outline") {
    process.stdout.write(o.json ? `${JSON.stringify(outlineJson(result), null, 2)}\n` : `${formatOutline(result, { color })}\n`);
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
    if (total) result = checkDeck(deckPath, nodeIo, opts);
  }
  process.stdout.write(o.json ? `${JSON.stringify(checkJson(result), null, 2)}\n` : `${formatCheck(result, { color })}\n`);
  return result.summary.errors || (o.strict && result.summary.warnings) ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
