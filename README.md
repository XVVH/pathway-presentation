# Pathway

Talks as landscapes: a presentation framework where the content is a map and the
talk is a route through it.

- [DESIGN.md](DESIGN.md): the idea, the decisions so far, and the build plan.
- [AGENTS.md](AGENTS.md): how to write a deck, for agents and people.
- [spike/](spike/): the motion prototype the engine grew from. Open
  `spike/index.html` in a browser and press →.
- [examples/pathway/](examples/pathway/): a deck about Pathway, with speaker notes.

## Using it

Needs Node 22.18 or later. Pathway runs its TypeScript directly, with no build
step.

```sh
npm install
node src/cli.ts check examples/pathway/pathway.md     # problems, with lines and fixes
node src/cli.ts present examples/pathway/pathway.md   # present from this machine, with notes
node src/cli.ts build examples/pathway/pathway.md     # a folder to present from anywhere
node src/cli.ts outline examples/pathway/pathway.md   # the map as a tree, and the route
node src/cli.ts fmt --write examples/pathway/pathway.md
node src/cli.ts render examples/pathway/pathway.md --all   # PNGs (needs Playwright)
node src/cli.ts inline-notes talk.md --write          # move a separate notes file into the deck
node src/cli.ts new-skin ../skins/brand.css           # start your own skin: colours and fonts
```

- `check` exits with 1 when the deck has errors (or warnings, with `--strict`).
  `--fix` applies the fixes it marks safe; `--json` is for agents and scripts.
- `present` serves on 127.0.0.1 and reloads as you edit. Press P in the browser for
  the presenter window: notes, timer, what's next, the detours within reach.
- `build` writes `<deck>-build/`. Its `index.html` opens from disk, offline, and
  can't reach the network. Speaker notes are left out unless you pass
  `--with-notes`.

## Development

```sh
npm test               # unit tests, no browser needed
npm run typecheck
npm run bundle         # rebuild runtime/pathway.js after changing src/runtime/
npm run e2e            # drive a built deck in Chromium (needs Playwright)
npm run build          # optional: emit plain JavaScript to dist/ for older Node
```

- **The engine** lives in `src/runtime/` and is bundled into `runtime/pathway.js`,
  which is committed so building a deck needs no bundler. CI fails if it's stale.
- **Size estimates.** The checker estimates card heights from measured font
  widths. Tests hold it to measurements of real cards stored in
  `test/calibration.json`. After changing fonts, the type scale in
  `src/typography.ts` or the card CSS, refresh it with
  `node scripts/measure-fonts.mjs` (fonts only) and
  `npm run calibrate -- --write test/calibration.json`. Both need Playwright.
