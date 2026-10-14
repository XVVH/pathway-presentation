# Pathway

Talks as landscapes: a presentation framework where the content is a map and the
talk is a route through it.

- [DESIGN.md](DESIGN.md): the idea, the decisions so far, and the build plan.
- [AGENTS.md](AGENTS.md): how to write a deck, for agents and people.
- [spike/](spike/): the motion prototype. Open `spike/index.html` in a browser and
  press →.
- [examples/pathway/](examples/pathway/): a deck about Pathway, with speaker notes.

## Checking a deck

Needs Node 22.18 or later. Pathway runs its TypeScript directly, with no build
step.

```sh
npm install
node src/cli.ts check examples/pathway/pathway.md     # problems, with lines and fixes
node src/cli.ts outline examples/pathway/pathway.md   # the map as a tree, and the route
node src/cli.ts check deck.md --json                  # for agents and scripts
```

`check` exits with 1 when the deck has errors (or warnings, with `--strict`).
`--fix` applies the fixes it marks safe.

## Development

```sh
npm test            # all tests
npm run typecheck
npm run build       # optional: emit plain JavaScript to dist/ for older Node
```

- **Size estimates.** The checker estimates card heights from measured font
  widths. Tests hold it to real browser measurements stored in
  `test/calibration.json`. After changing fonts or the type scale in
  `src/typography.ts`, refresh it with
  `node scripts/measure-fonts.mjs` and
  `node scripts/calibrate.mjs examples/pathway/pathway.md test/fixtures/calibration/calibration.md --write test/calibration.json`.
  Both scripts need Playwright.
