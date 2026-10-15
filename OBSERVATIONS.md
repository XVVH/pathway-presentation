# Observations

Friction noticed while using Pathway on real talks, logged as it comes up. Each
entry says what happened and what we might do about it, and stays open until
we decide. Describe the friction, never the talk: real content stays on the
machine it was written on.

## Open

### The unknown-skin warning doesn't explain how to use your own skin

*2026-10-15 · `pathway check`, `present`*

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

*2026-10-15 · folder layout*

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

*2026-10-15 · `pathway present`*

The assumption was that the page only changes after a build. In fact, `present`
re-checks and reloads on every save and keeps your place. The README says this,
but it didn't stick.

Possible fixes:

- Say it when `present` starts: "Watching the deck: save and the page reloads
  where you were."
- Show a brief "Updated" notice on the page after each reload.
