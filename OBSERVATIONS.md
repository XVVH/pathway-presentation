# Observations

Friction noticed while using Pathway on real talks, logged as it comes up. Each
entry says what happened and what we might do about it, and stays open until
we decide. Describe the friction, never the talk: real content stays on the
machine it was written on.

Each entry starts with the date and the commit of Pathway it was seen on, so we
can tell later whether a change fixed it. Find the commit in your Pathway clone
with `git log -1 --format=%h`.

## Open

### The unknown-skin warning doesn't explain how to use your own skin

*2026-10-15 · f18299d · `pathway check`, `present`*

Writing the skin folder's name (`skin: brand-talks`) gives "Unknown skin
'brand-talks'". The message does mention giving a path, but only at the end, and
it doesn't say the path leads to the `.css` file, starting from the deck's
folder. So a folder name or skin name looks like it should work.

Possible fixes:

- Lead with what to write: `skin: ../skins/brand.css`, the path from the deck's
  folder to the skin's `.css` file.
- When the value isn't a built-in name, look for `.css` files near the deck
  (in its folder, a `skins/` folder beside it, or one in a parent folder) and
  suggest the actual path, with a safe fix.

### Where a talk sits relative to the template and skins is confusing

*2026-10-15 · f18299d · folder layout*

The brand template ships as one folder holding `skins/` and `template/`, with
talks as folders next to them. In practice that reads as talks nested inside
the template package. It's also why every deck needs a relative path like
`../skins/brand.css`, which breaks if a talk moves.

Possible fixes, to weigh together with the first entry:

- **Skins by name.** `skin: brand` would find `skins/brand.css` in the deck's
  folder or any folder above it, or in a user-wide skins folder. Decks would
  stop carrying relative paths, and moving a talk wouldn't break its skin.
- **Starting a talk is a command.** `pathway new q3-review --from <template>`
  would make the folder, rename the deck to match and set the skin. Then nobody
  copies or renames by hand.
- Separate the shared things (skins, templates) from the talks folder in the
  README's suggested layout.

### Live reload in `present` wasn't obvious

*2026-10-15 · f18299d · `pathway present`*

The assumption was that the page only changes after a build. In fact, `present`
re-checks and reloads on every save and keeps your place. The README says this,
but it didn't stick.

Possible fixes:

- Say it when `present` starts: "Watching the deck: save and the page reloads
  where you were."
- Show a brief "Updated" notice on the page after each reload.

### Structuring a talk as a map takes a shift from slides

*2026-10-15 · f18299d · first deck*

The first real deck took a while to structure, coming from PowerPoint. It
checked clean, but slide habits showed in its shape:

- Trunk titles were topics ("Audience") rather than claims, so the whole map
  reads as a list of sections instead of the argument.
- Stops with only a title, used like section-divider slides. On a map the
  branch already shows the grouping.
- A stop whose only child is another stop: two hops where one would do.
- The bottom line written as questions. Phones open on it and the talk ends on
  it, so statements stick better.

Possible fixes:

- A short "Coming from PowerPoint" guide: a section slide becomes a trunk stop
  that states its point, the appendix becomes detours, presenter notes become
  `::: notes`.
- Gentle `check` hints (info, not warnings) for title-only stops with children,
  and for single-child chains.
- A workflow skill that proposes a map from a pile of content, then reviews the
  draft for exactly these habits, and for the run-together lines below. Applied
  by hand to the first deck, these fixes took it from 21 stops to 19 and made
  the whole map read as the argument.

### Lines written one under another run together on the card

*2026-10-15 · f18299d · cards*

Two short lines typed one under the other, with no blank line or bullets
between them, render as one sentence: "Fast to write" and "Easy to change"
become "Fast to write Easy to change". That's standard Markdown, but in
PowerPoint every line is its own line, so it reads as a bug, and `check` says
nothing.

Possible fixes:

- Treat a line break inside a paragraph as a line break on cards. This matches
  what people expect from slides. It costs anyone who hard-wraps prose, which
  `fmt` doesn't do.
- Or keep Markdown's rule and have `check` flag paragraphs with line breaks in
  them, with a safe fix that turns the lines into bullets.

### The browser tab and the title card can disagree

*2026-10-15 · f18299d · frontmatter*

`title:` in the frontmatter names the page (the browser tab and the legend),
while the `#` heading is the title card. In the first deck they said different
things, and nothing pointed it out. The starter template asks for both, which
invites it.

Possible fixes:

- Drop `title:` from the template and use the `#` heading everywhere, keeping
  `title:` only for when the tab should differ.
- Or an info note from `check` when the two differ.

Since then, the brand template (kept outside the repo) no longer sets `title:`.
The `check` note is still open.
