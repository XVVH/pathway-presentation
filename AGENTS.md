# Writing Pathway decks

This guide is for agents (and people) writing or editing Pathway decks. A deck is
plain Markdown. Pathway lays it out as a map, and the talk is a route through it.
Nothing here is invented syntax: headings, lists, images, YAML frontmatter,
Pandoc-style `{attributes}` and `[[wiki links]]`.

## The loop

1. Write or edit the deck.
2. Run `pathway check deck.md --json`.
3. Fix every error, then the warnings. Each diagnostic has a line and usually a
   `fix`.
4. Repeat until it reports no problems.
5. Run `pathway fmt --write deck.md` to tidy the layout.

`pathway check deck.md --fix` applies the fixes marked `safe`.
`pathway outline deck.md --json` shows the tree, ids, word counts, card sizes and
the route, which is useful before restructuring. (From a clone of this repo, run
`node src/cli.ts` in place of `pathway`.)

To see what the audience sees, `pathway render deck.md --stop <id>` saves a PNG of
one stop (`--map` for the whole map, `--all` for everything) into `deck-shots/`. Look
at crowded stops before calling a deck done. It needs Playwright; if it isn't
installed, say so rather than installing it unasked.

## Presenting

- `pathway present deck.md` serves the deck on this machine (127.0.0.1), reloads it
  as the files change, and shows check errors over the page. Press P for the
  presenter window with the speaker notes.
- `pathway build deck.md` writes `deck-build/`: open its `index.html` in any browser,
  offline. It refuses a deck with errors (`--force` overrides). Speaker notes stay
  out unless you pass `--with-notes`; don't add that flag unless the person asked,
  since anyone with the folder can read them.
- Keys: → next, ← back, ↓ detour, ↑ pull back, M map, P presenter, Q bottom line and
  QR code, V tour, R remote (for screen share), B blank, D dark or light, F full
  screen, ? help.
- Clicking a stop looks at it without losing your place: → rejoins the route where
  you left. C carries on the talk from the stop you're looking at instead.

## Files

```
my-talk/
  my-talk.md          the deck
  media/              images and video, referenced by relative path
```

## The deck

```markdown
---
title: Why Pipelines Stall
skin: sectional          # or boardroom, or the path of your own skin's .css
density: talk            # or technical
routes:
  exec: [intake, fix]    # named routes are lists of stop ids
url: https://intranet.example.com/talks/pipelines/   # where the audience copy lives
---

# Why pipelines stall
Every team hits the same three walls.

::: takeaways
- Limit work in progress.
- Make the queue visible.
:::

## Intake {#intake}
Requests arrive faster than anyone triages them.

![The intake funnel](media/funnel.svg)

::: notes
Ask who triaged anything this week. Pause on the funnel.
:::

### Triage is a queue {.detour}
Skipped by the route; one key away when someone asks. See [[intake]].

## The fix {#fix}
- Limit work in progress
- Make the queue visible
```

### Stops

- **Each heading is a stop.** Its body is everything up to the next heading.
- **There is exactly one `#` title**, the first heading. `##` stops are the trunk,
  the talk's main points. `###` and deeper are branches.
- **Go down one level at a time** (`##` → `###`, never `##` → `####`).
- **Stay within three levels below the trunk.** Deeper than that warns; audiences
  lose their place.
- **Ids** come from `{#id}` after the title, otherwise from the title: lowercase,
  with anything that isn't a letter or digit becoming `-` ("How it's written" →
  `how-it-s-written`). Give a stop an explicit id if anything refers to it, so
  renaming the title doesn't break links, routes or notes.
- **Attributes** go in `{…}` at the end of the heading:
  - `{.detour}`: the default route skips this stop. It stays one key away for
    questions, and suits deep or technical material.
  - `{density=technical}`: allows more text on this stop. See Density.
  - Write a literal trailing brace as `\{`.

### Content

- Paragraphs and bullet lists. A bullet that opens with a **bold phrase** reads as
  a heading: when a stop is crowded, each one should become a child stop.
- Numbered lists, nested lists, block quotes, tables and `---` rules.
- Fenced code blocks. Lines wider than the card are cut off, and the checker says
  where.
- **One** image or video per stop, on a line of its own:
  - `![Alt text](media/x.png)`: sits beside the text.
  - `![Alt text](media/x.png){.wide}`: spans the card below the text.
  - Video: `![Caption](media/clip.mp4){loop}`. Its alt text becomes the caption.
  - Media must be local files inside the deck folder. Media from the web, or from
    outside the folder, shows as a placeholder: a built deck never reaches the
    network.
- Links between stops: `[[stop-id]]` or `[[stop-id|link text]]`. On screen they
  take you there. Web links open in a new tab.
- No raw HTML. It isn't rendered.

### Skins

`skin:` names a built-in skin (`sectional`, `boardroom`) or a skin file, by path
from the deck's folder. `pathway new-skin brand.css` writes a starter that begins
from Boardroom: set colours (light and dark), and fonts with `@font-face` pointing at
font files beside the skin. Card sizes come from those files, so a skin's fonts
change what fits. Re-run `pathway check` after changing a skin.

### Density

Cards are sized to fit their content, up to a cap. Two limits apply:

| Density | Error: doesn't fit (approx.) | Warning: too much to read while listening |
|---|---|---|
| `talk` (default) | ~120 words of prose, 9 bullets, 11 code lines | over 40 words, 5 bullets, or 8 code lines |
| `technical` | ~190 words, 11 bullets, 15 code lines | over 160 words, 8 bullets, or 12 code lines |

Text beside an image holds roughly half as much. Word counts cover body text
only, not titles or captions.

**When a stop is over, move content, don't cut it:**

- Spoken detail goes into the speaker notes for that stop.
- Explorable detail goes into child stops one level down.
- Bold-led bullets become child stops, and the parent keeps a one-line summary.
  The checker's fix for this case includes the exact edits.
- Dense technical material that only some of the audience wants becomes a detour
  with `{.detour density=technical}`.

### Style

- Titles are short statements of the point ("Handoffs lose a day each"), not
  topics ("Handoffs").
- One idea per stop. A trunk usually has 4 to 7 stops; a branch, 2 to 5.
- On screen: the claim and the evidence. In the notes: the story you tell around
  it.

## The bottom line and the handoff

- **Takeaways** are the whole deck's bottom line: one `::: takeaways` block under the
  `#` title, usually a short list. They're never on a card. Phones open with them, and
  the talk ends on them, beside the whole trail. Anywhere else they're flagged
  (`takeaways-misplaced`) and not shown.
- **`url`** in the frontmatter (or `pathway build --url`, which wins) is where the
  audience copy of the deck will live. The closing view shows it as a QR code, drawn
  at build time. It must be a full `https://` (or `http://`) address
  (`url-invalid`). Without one, the closing view shows the takeaways alone.
- Q shows or hides the panel at any point in the talk.

## Speaker notes

Write a stop's notes inside it, between `::: notes` and `:::` on lines of their
own. They're Markdown, they're never on the card, and they don't count toward its
density. They move with the stop, so renaming or reordering can't lose them.

- A stop can have more than one notes block; they're shown in order.
- A heading ends notes even without the closing `:::`. The checker flags that
  (`notes-unclosed`), with a safe fix.
- Notes are private: builds leave them out unless `--with-notes` is given.

**A separate notes file** (`deck.notes.md` beside the deck, or `notes: path` in the
frontmatter) also works. Each heading in it opens the notes for one stop, by the
stop's title or by `{#id}` on the heading. Renaming a stop breaks a match by
title, so prefer inline notes. `pathway inline-notes deck.md --write` moves a notes
file into the deck.

## Routes

- **The default route** is reading order. It starts and ends on the whole map, and
  pulls back over each branch when the branch ends. Detours are skipped.
- **Named routes** in the frontmatter list stop ids in the order to visit them.
  They're useful for a short cut of a long talk. Pick one in the presenter window,
  or open the deck with `?route=name`. A route starts on the whole map and the title,
  and ends on the whole map.

## `check --json` output

```json
{
  "version": 1,
  "deck": "talks/pipelines.md",
  "notes": "talks/pipelines.notes.md",
  "summary": { "errors": 1, "warnings": 0, "infos": 0, "stops": 12, "detours": 2, "withNotes": 9 },
  "diagnostics": [{
    "code": "broken-link", "severity": "error",
    "file": "talks/pipelines.md", "line": 18, "column": 5, "stop": "handoffs",
    "message": "[[Intake]] doesn't match any stop. Did you mean [[intake]], the id of \"Intake\"?",
    "fix": {
      "description": "Link to [[intake]].", "safe": true,
      "edits": [{ "file": "talks/pipelines.md", "startLine": 18, "endLine": 19, "newText": "See [[intake]]." }]
    }
  }]
}
```

- **What an edit does.** Each edit replaces lines `startLine` up to (not including)
  `endLine` with `newText`. Line numbers are 1-based. Equal start and end lines
  insert. An empty `newText` deletes the lines.
- **Applying edits.** Every edit refers to the original file, so apply each file's
  edits from the bottom up. `fix.safe` marks fixes that can be applied without
  judgment.
- **Exit codes.** 1 when there are errors (or warnings, with `--strict`), 2 for
  usage problems, otherwise 0.

## Diagnostic codes

**Errors** (the deck is broken):

- **Structure:** `no-title`, `multiple-titles`, `heading-skip`, `empty-title`,
  `no-id`, `duplicate-id`, `root-detour`, `bad-attribute`, `unknown-density`
- **Frontmatter:** `frontmatter-unclosed`, `frontmatter-yaml`, `frontmatter-type`,
  `route-format`, `route-empty`, `route-unknown-stop`, `url-invalid`
- **References:** `broken-link`, `missing-media`, `notes-file-missing`,
  `skin-not-found`, `skin-font-missing`
- **Density:** `stop-overflow`

**Warnings** (the deck works, but something is off):

- **Density:** `stop-dense`, `too-many-bullets`, `long-code`, `code-line-clipped`,
  `multiple-media`
- **Structure:** `too-deep`, `empty-stop`, `no-stops`, `nested-heading`,
  `content-before-title`
- **Media:** `inline-media`, `remote-media`, `absolute-media-path`,
  `media-outside-deck`, `unsupported-media`
- **Names and keys:** `unknown-attribute`, `unknown-frontmatter-key`,
  `unknown-skin`, `route-duplicate-stop`, `raw-html`
- **Skins:** `skin-base-unknown`, `skin-font-unmeasured`, `skin-font-unreadable`,
  `skin-bend-unknown` (and `skin-font-variable`, for information)
- **Notes:** `notes-unclosed`, `notes-orphan`, `notes-ambiguous`, `notes-duplicate`,
  `notes-preamble`
- **Takeaways:** `takeaways-unclosed`, `takeaways-misplaced`
