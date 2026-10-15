# Pathway

Talks as landscapes: a presentation framework where the content is a map and the
talk is a route through it.

- [DESIGN.md](DESIGN.md): the idea, the decisions so far, and the build plan.
- [AGENTS.md](AGENTS.md): the deck format in full, for agents and people.
- [examples/pathway/](examples/pathway/): a deck about Pathway, with notes and a
  bottom line.
- [spike/](spike/): the motion prototype the engine grew from.
- [OBSERVATIONS.md](OBSERVATIONS.md): friction noticed while using Pathway on real
  talks.

## Install

Needs Node 22.18 or later. Pathway runs its TypeScript directly, with no build step.

```sh
git clone https://github.com/XVVH/pathway-presentation.git
cd pathway-presentation
npm install
npm link        # puts `pathway` on your PATH; or run `node src/cli.ts` from here
```

## Preparing a talk

A talk is one Markdown file and its media. That file is the only thing you edit:
you present from it, and you build from it the copy you hand out.

```
talks/
  skins/                  your own skins and their fonts, shared by talks (optional)
  pipelines/
    pipelines.md          the deck: stops, speaker notes, the bottom line, its address
    media/                images and video
    pipelines-build/      made by `pathway build`: the audience copy you upload
```

### 1. Start the deck

```markdown
---
title: Why pipelines stall
skin: boardroom                     # or sectional, or ../skins/brand.css
url: https://intranet.example.com/talks/pipelines/   # where the audience copy will live
---

# Why pipelines stall
Every team hits the same three walls.

::: takeaways
- Limit work in progress.
- Make the queue visible.
:::

## Intake is a queue {#intake}
Requests arrive faster than anyone triages them.

![The intake funnel](media/funnel.svg)

::: notes
Ask who triaged anything this week. Pause on the funnel.
:::

### Triage rules {.detour}
Skipped by the route; one key away when someone asks.

## Fix the flow {#fix}
- Limit work in progress
- Make the queue visible
```

- **Each heading is a stop.** `##` stops are the main points, `###` and deeper
  branch off them, and `{.detour}` keeps a stop off the route until someone asks.
- **Notes** go inside their stop, between `::: notes` and `:::`, so they move when the
  stop moves. They're never on screen.
- **The bottom line** goes under the title. The talk ends on it, and phones open on
  it.
- **`url`** is where the audience copy will live. The talk ends on a QR code for it.

[AGENTS.md](AGENTS.md) has the whole format: links between stops, media, density,
named routes.

### 2. Write with it open

```sh
pathway present talks/pipelines/pipelines.md
```

Open http://127.0.0.1:4310/. Every time you save, the page reloads where you were
and re-checks the deck; problems show in the terminal and over the page. When you
want the full list, with fixes:

```sh
pathway check talks/pipelines/pipelines.md          # --fix applies the safe ones
pathway fmt --write talks/pipelines/pipelines.md    # tidies spacing, changes nothing else
```

If a stop is crowded, the checker says so and suggests what to move: detail into
the notes, or into a child stop. `pathway render pipelines.md --stop intake` saves a
picture of a stop as the audience will see it (this needs Playwright).

### 3. Rehearse

In the browser, press **Walk the talk** and use → to travel.

- **P** opens the presenter window: your notes, what's next, the detours within
  reach, a timer and a clock.
- **V** plays the whole route by itself, so you can check the pacing.
- If the deck has named routes (a short cut of a long talk), pick one in the
  presenter window.
- **R** switches to remote motion, for screen sharing; try it if you'll present on
  Teams or Zoom.

### 4. Publish the audience copy

```sh
pathway check talks/pipelines/pipelines.md --strict
pathway build talks/pipelines/pipelines.md          # writes talks/pipelines/pipelines-build/
```

Copy `pipelines-build/` to the address in `url:`. It holds `index.html`, the media
and the fonts. It never contains your notes, and it makes no network requests.
Then open that address on your phone: it should show the bottom line, then the talk
as a scrolling strip. That's what the QR code at the end of your talk opens.

A publishing service does the same with its own address:
`pathway build talk.md --url https://slides.example.com/client-talk/`, then uploads
the folder.

### 5. Present

```sh
pathway present talks/pipelines/pipelines.md
```

1. Open http://127.0.0.1:4310/ in the window the audience will see, and press **F**
   for full screen on the projector or shared screen.
2. Press **P** and drag the presenter window to your own screen. The timer starts when
   you leave the title.
3. Use → or a clicker. It works whichever window has focus.

During the talk:

- **↓** takes the detour offered at this stop, and **→** comes back to the route.
- Clicking a stop looks at it, and **→** comes back. **C** carries on the talk from
  there instead.
- **B** blanks the screen, and any key brings it back.
- **Q** shows the bottom line and the QR code at any point. The talk ends on them,
  beside the whole trail you walked.

**On a machine without Node**, build a copy with notes and present from its
`index.html`; P works the same:

```sh
pathway build talks/pipelines/pipelines.md --with-notes   # writes pipelines-presenter/
```

Never upload that folder: anyone with it can read your notes. If it's ever opened
from a web address, it says so on screen.

### Your own skin

```sh
pathway new-skin talks/skins/brand.css
```

The new skin starts from Boardroom. Change its colours (light and dark), put the font
files next to it, and point decks at it with `skin: ../skins/brand.css`. Card sizes
come from the font files themselves. Builds copy the fonts into the folder and remind
you to check their licence before it leaves your organisation.

## Commands

| Command | What it does |
|---|---|
| `pathway present deck.md` | Serve the deck on 127.0.0.1 with notes and live reload. |
| `pathway check deck.md` | Find problems, with line numbers and fixes. `--json` for agents, `--fix`, `--strict`. |
| `pathway build deck.md` | The audience copy: an offline folder with no notes. `--url`, `--with-notes`, `--out`. |
| `pathway fmt deck.md` | Tidy spacing. `--write` to change the file, `--check` for CI. |
| `pathway outline deck.md` | The map as a tree, and the routes. |
| `pathway render deck.md` | Pictures of stops: `--stop <id>`, `--map`, `--all`. Needs Playwright. |
| `pathway new-skin file.css` | Start your own skin. |
| `pathway inline-notes deck.md` | Move a separate notes file into the deck. `--write` to do it. |

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
- **Size estimates.** The checker estimates card heights from font widths: measured
  tables for the built-in fonts, and the font files themselves for your own skins.
  Tests hold it to measurements of real cards stored in `test/calibration.json`.
  After changing the type scale in `src/typography.ts` or the card CSS, refresh them
  with `npm run calibrate -- --write test/calibration.json` (needs Playwright).
