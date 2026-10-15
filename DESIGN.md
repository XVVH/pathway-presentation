# Pathway: design notes

Status: ideation, with a motion prototype in `spike/`. Nothing here is final.

## The idea

A slide deck is a corridor: door after door, in a fixed order. A Pathway talk is a
landscape the audience travels across with you. Two things are kept apart:

- **The map** is the content. Every idea has a place on it, and the computer lays it out.
- **The route** is the talk: an ordered path through the map.

Nearly every requirement falls out of that split:

| Need | How it falls out |
|---|---|
| Sequenced transitions, "return home" at the end of a branch | The default route is reading order, with a pull-back over each branch when it ends. Nothing to author. |
| Explore mode for viewers | The map with no route. |
| Video explainers | The route played on a fixed clock. Speaker notes become the narration script. |
| Short and long versions of one talk | Several routes over one map. |
| Questions from the room | Detours: branches the route skips but keeps one key away. → always rejoins the route. |

## Decisions so far

### 1. A landscape, not nested rooms

Rooms read as hierarchy even when the content is hierarchical, so the map is terrain:

- The **trunk** runs east with a gentle meander. Its stations are the talk's main points.
- Each trunk station sends its **branch** up or down, alternating sides. A branch leaves
  steeply and bends downstream, the way a road climbs out of a valley. Deeper detail
  starts forward and bends away from the trunk. Each level is smaller (1, 0.62, 0.42,
  ...), so detail is something you descend toward, not something you open.
- **Zoom is altitude.** From high up you read station names, as on a chart. Lower down,
  the placards become readable.
- Placement is greedy: each station steps from the previous one along the current
  heading, then slides forward until it touches nothing. Curves can't cause collisions,
  however many branches there are. There are no coordinates in the source, ever.

### 1a. Greek in place: nothing resizes, nothing rewraps

Every card is laid out once, at reading size, and only ever scales with the camera.
When a line of text gets too small to read, it dissolves into a bar the exact shape
of itself, measured from the line's real box, and resolves back into words as you
come closer. This old typesetting trick is called greeking. Each element crossfades
with its own bars by how many pixels tall its type is on screen: body at ~7-8px, titles
a little later at ~6-7px, because they are bigger to begin with.

- People read while the camera moves, so nothing a reader might be following ever
  jumps, resizes or rewraps. (`spike/text-zoom-lab.html` compared four approaches;
  swapping to a larger glance title broke reading mid-zoom.)
- The map labels itself the way a real map does. From far out, the large trunk titles
  are still readable, like city names, and branch detail is shapes, like streets. The
  hierarchy comes from size alone.
- There are no separate floating labels. The card is its own label.
- The text stays in the page (only its opacity changes), so screen readers and
  find-in-page still see all of it.

**Hover (mouse only, never required).** Zooming to read is the fun of this format, so
hover invites the trip instead of replacing it. Pointing at a station rings it and
lights the unwalked trail from where you are to it, dash for dash over the trail
beneath (same pattern, same start, same direction, so the two never interleave). One
click flies there. Hover never shows the title: the reveal is earned by travelling.
Moving the camera or pressing a key clears hover, so a presenter's idle cursor never
decorates the screen.

### 2. Motion grammar

In means detail. Out means context. Across means next. Nothing rotates. Audiences learn
this within a couple of moves, and then the motion itself tells them where they are.

Every move ramps in, cruises, and ramps out: a trapezoid velocity profile with smooth
ramps, about a third of the move each way. Nothing snaps.

- **Neighbouring stops: follow the trail.** The camera rides the trail's own curve,
  rising a little mid-way to show the land around, and the route line draws itself
  right under the camera. Typical hops take 1.6 to 2 seconds.
- **Longer jumps: fly.** Pull-backs, detours and jumps across branches follow van Wijk &
  Nuij (2003), *Smooth and efficient zooming and panning*. The camera climbs toward the
  ground the two ends share and descends again, so a long jump shows how they relate.

Durations come from distance travelled, measured in screens, so short hops stay short
and long flights take longer, up to a cap set by the skin.

### 3. Source format: Markdown, with no invented syntax

```markdown
---
title: Why Pipelines Stall
skin: consultancy
routes:
  exec: [intake, fix]
---

# Why pipelines stall
Every team hits the same three walls.

## Intake {#intake}
![Funnel](media/funnel.svg)

### Triage is a queue {.detour}
Skipped by the route. One key away.

## Handoffs
Same failure as [[intake]], different costume.
```

- Headings are stations. Heading depth is distance from the trunk.
- Attributes use Pandoc's `{#id .class key=value}`, and links use `[[wiki-links]]`.
  LLMs already know both, which makes agent-written decks valid on the first try.
- Speaker notes sit under their stop, between `::: notes` and `:::` (Pandoc's own
  syntax for reveal.js speaker notes). They move when the stop moves, and renaming
  can't break them. A separate `talk.notes.md` with matching headings still works,
  for notes kept apart from the deck; see 3a.
- Authors write text. Agents get JSON back out: the parsed tree and diagnostics with
  line numbers.

### 3a. Notes live with their stop

Notes first lived in a separate file, matched to stops by heading. That breaks
whenever a stop is renamed or moved, which is most of the time while a talk is
being written. Now they're written inside the stop:

```markdown
## Intake {#intake}
Requests arrive faster than anyone triages them.

::: notes
Ask who triaged anything this week. Pause on the funnel.
:::
```

- Cutting and pasting a stop takes its notes along. There is nothing to link.
- A heading always ends the notes, even without the closing `:::`, so a forgotten
  fence can't swallow the rest of the deck. The checker flags it, with a safe fix.
- Notes never count toward what a card holds.
- The separate file still works, for people who want notes physically apart (to
  share a deck's source without them). The checker flags notes in both places, and a
  title shared by two stops, which attaches to neither. `pathway inline-notes` moves
  a notes file into the deck in one step.
- Sharing the deck's source now shares its notes. Builds still leave them out unless
  asked.

### 4. A deck is a folder, not a single file

Opening `index.html` from disk (`file://`) blocks module scripts and `fetch`. It does
**not** block `<img>`, `<video>` or fonts loaded by relative path. So:

```
my-talk-build/
  index.html        the engine, styles and all text, inlined
  media/            the images and video the deck uses, as plain files
  fonts/            the skin's fonts, with their licence
```

`pathway build` makes it. Zip it, host it, or double-click it. `--single-file` could
become an opt-in for small, image-only decks you want to email.

The build earns its keep on media:

- Check every reference.
- Transcode video to H.264 MP4 (Safari, corporate machines) plus WebM (Chromium,
  headless capture), with poster frames.
- Make phone-sized image variants and content-hashed filenames.
- At runtime, load media like a game streams a level: only stops near the camera
  load, and the next stops on the route prefetch.

### 5. One clock

Everything on screen is a pure function of time: `render(t)`.

- **Live** mode appends camera segments as you navigate.
- **Tour** mode precomputes the route with hold times.
- **Capture** steps the same clock frame by frame in headless Chromium and pipes the
  frames to ffmpeg. Embedded clips seek with the clock.

No CSS transitions or fire-and-forget animations. They can't be seeked, so they would
make video export a rewrite. This is the decision that keeps the
manim / Remotion / HyperFrames stretch goal cheap. HyperFrames uses the same pattern
(HTML, a timeline, and headless Chrome), so it could become an export target later.

### 6. The camera is modeled for 3D, with a flat lens

A 2D zoom is a dolly with an orthographic lens. Pitching the camera, adding
perspective, and giving branches a little height later turns "zoom" into "follow the
trail toward the horizon". That's a change to the lens, not a new engine.

### 7. Remote presenting is a first-class case

- **Remote motion profile**: shorter, flatter flights over plain ground. Screen-share
  encoders drop frames when every pixel changes at once, and moving terrain makes every
  pixel change.
- **Follow link** (later): instead of sending pixels, viewers open a link and their own
  browser renders the motion, synced to the presenter's camera. After the talk the same
  link becomes explore mode, which is also the handoff. It needs a small relay
  (WebSocket), which may be off-limits for work talks. The remote profile is the
  baseline that always works.

### 8. The handoff replaces "notes + a link to the slides"

A QR code on the final view opens the deck on the viewer's phone. A shrunken
presentation doesn't work on a phone, so small screens get a different view of the
same map, a **strip map**. Old road atlases unrolled a journey into a vertical strip
in the same way.

- The route becomes one scrolling column of readable cards. Scrolling is walking.
- A rail down the left shows the trunk, with branches peeling off as indented side
  lines. It lights up in the route color down to the reading line.
- Detours are folded away and open on a tap.
- The landscape is one tap away (**Map**). It opens at your reading position with the
  trail lit up to there, and tapping any station takes you back to that point in the
  strip.

Strip mode applies whenever the screen is under 760px wide or 500px tall, so phones
in landscape get it too. Each trunk stop can carry a one-line takeaway, so the concise
notes you hand out today can lead the strip.

### 9. Offline and private by default

A built deck makes zero network requests: no CDNs, no hosted fonts, no telemetry.
Fonts ship in `fonts/`. Speaker notes are never in the build unless asked for
(`--with-notes`, which says so when it runs).

This is enforced, not just intended. The page carries a content security policy that
allows only its own inline engine (by hash) and files beside it. A deck that links an
image from the web gets a placeholder at build time, and even a hand-edited page can't
fetch anything. `pathway present` listens on 127.0.0.1 only, answers only to that host
name (so a web page can't reach it by DNS rebinding), and serves only the files the
deck uses: not the deck's source, not its notes file, nothing else in the folder.

### 10. Skins are tokens for color, type, and motion

A skin is a CSS file of custom properties (`skins/<name>.css`), with light and dark
values. It sets palette and typefaces, plus motion: flight speed, maximum duration, how
high flights climb, and the terrain style. Each skin also picks how hard the trails
bend (gentle, bold or winding, in `src/typography.ts`). A corporate skin moves briskly
over gently curving trails; a personal one can take its time on winding ones. Two ship:
**Sectional** (an aeronautical chart, with the route drawn as the magenta line, bold
curves) and **Boardroom** (gentle).

A skin changes the map's geography as well as its look: new curves, and new card
heights, since its fonts set differently. So the skin is chosen when the deck is
built, and the map is fixed from then on. The audience can still switch between light
and dark (D).

**Your own skin** is a CSS file the deck names by path (`skin: ../skins/brand.css`),
for a day-job palette or a client's. `pathway new-skin brand.css` writes a starter.

- It starts from a built-in skin (`--base-skin`), and overrides whatever it sets:
  colours in light and dark, fonts, terrain, motion and `--bend`.
- Fonts are files beside the skin, declared with `@font-face`. The checker reads each
  file's advance widths directly (TrueType, OpenType, WOFF, WOFF2), so card sizes for
  a brand font are as accurate as for the built-in ones, with no browser and no
  measuring step. For the built-in fonts, the widths read from the files match the
  browser-measured tables exactly; for a TrueType stand-in "brand" font, estimates
  matched the browser within 0.0013 of card width on every card of the example.
- Builds copy the skin's fonts into `fonts/skin/` and say so, since a brand font may
  be licensed for internal use only. Brand fonts never belong in this repository:
  keep the skin beside your talks.
- A family the skin doesn't supply (say, a system font) can't be measured, and might
  not be on the presenting machine; the checker warns and estimates with the base
  skin's fonts.

### 10a. Cards fit their content, within a system

- **Width is fixed per level** (trunk, branch, deeper). That keeps line length, the
  trail rhythm, and the camera's zoom at each stop consistent.
- **Height fits the content**, snapped to sixteenths of the width, between a floor (a
  one-line stop is a signpost, not a sliver) and a cap of 0.8 of the width.
- **More content than the cap is a lint error**, not a scrollbar: "this stop holds too
  much; branch it." The format's answer to a long slide is depth.
- **Heights are measured once, at a fixed reference width, never from the screen.**
  Type is sized relative to the card, so the measurement holds at any resolution. The
  map is then the same on a laptop, a projector, a phone, and in every rendered video.
  The build bakes the heights (and image and video dimensions) into the output, so the
  runtime never measures and nothing shifts while loading.

For video this helps more than it hurts:

- The camera frames a stop by its width, so each level has the same zoom throughout a
  video. A short card simply shows more landscape around it.
- Only a card at the cap can force the camera to pull back slightly, and the linter
  keeps that rare.
- Vertical 9:16 renders work as is: cards fill most of the frame width, and the trail
  runs above and below them.
- One more option, since the layout is computed: a vertical render could run the trunk
  south instead of east, so the final pull-back fills a portrait frame. It would be the
  same map in a different projection, like the strip map.

### 10b. Density: how much a stop holds

A deck sets its density in frontmatter (`density: talk`), and a single stop can
override it (`## Wire protocol {density=technical}`). Density sets two things:

- **Body type size relative to the card.** This sets the hard limit, because smaller
  type means more words physically fit.
- **The reading limit.** This is how much the audience can take in while listening.

| Density | Body type | Line length | Fits at most | Warn above |
|---|---|---|---|---|
| **talk** (default) | 3.3% of card width | ~60 characters | ~120 words, 9 bullets, 11 code lines | 40 words, 5 bullets, 8 code lines |
| **technical** | 2.6% of card width | ~72 characters | ~190 words, 11 bullets, 15 code lines | 160 words, 8 bullets, 12 code lines |

The "fits at most" figures were measured at reading size with Sectional fonts and a
one-line title. Text beside an image or video holds roughly half as much. Boardroom's
wider font holds about 5% less.

- **Error: it doesn't fit.** The content is taller than the size cap at reading size.
  The camera would have to shrink the text, so this can't be overridden.
- **Warning: too much to read while listening.** Only body text counts, not titles,
  eyebrows or captions.
- **The fix is a move, not a cut.** Spoken detail goes to the speaker notes, and
  explorable detail becomes child stops. The checker proposes the specific split. For
  example, bullets that each start with a bold phrase are really sub-stops, so it
  suggests one child per bullet, with a one-line summary left on the parent.

The default is deliberately light: on-screen content stays simple, and the speaker
talks to it from the notes. A dense technical stop often works best as a **detour**,
skipped by the route and one key away for the audience that wants it.

### 11. Built for agents

- `pathway check` reports 42 kinds of problem, with line numbers, as text or JSON:
  structure, links, media, routes, notes drift, depth, and density. Each comes with a
  fix where there is one. Fixes are line edits, and the safe ones apply with `--fix`.
  For crowded stops with bold-led bullets, the fix includes the exact edits to turn
  them into child stops.
- **The size check needs no browser.** It wraps text word by word using advance
  widths measured from the skins' real fonts (`src/metrics.ts`). Tests hold it to
  measurements of 80 cards in both skins, taken from the real engine in a browser:
  paragraphs, lists (bulleted, numbered, nested), code, quotes, tables, rules,
  images beside and below text, video, technical density, and deliberately
  overflowing stops. It agrees within 0.002 of card width on every card that fits.
  On the longest paragraphs it runs about one line high, so it errs toward flagging.
- `src/typography.ts` is the single source of truth for the type scale. The checker
  estimates from it, and the page's card CSS is generated from it, so they can't
  drift apart. The build bakes each card's height from the estimate, so the map is
  identical on every screen and in every render.
- `pathway render deck.md --stop <id>` (or `--all`) writes PNGs as the audience sees
  them, so a vision model can critique density and layout. It needs Playwright,
  which nothing else does.
- `AGENTS.md` describes the format in a page. Since the format invents nothing, it
  stays short.
- `pathway fmt` normalizes what an LLM writes, without changing what it says: tests
  check the parsed deck is the same before and after.

### 12. Stack: TypeScript

The runtime has to be JavaScript in a browser. Writing the compiler in TypeScript
lets it share types with the runtime and run in two hosts: a Node CLI for agents and
CI, and a browser page you drop a folder onto. That second host matters if Node can't
be installed on a locked-down work machine.

### 12a. Leaving the route never moves your place

You can leave the route three ways: take a detour (↓), click a stop, or drag and
zoom. Whichever you do, your place on the route stays where you left it, → rejoins
there, ← returns there, and the status line says so ("Off route · → rejoins at stop
04"). What → does never depends on anything you can't see.

An earlier version moved your place when you clicked a stop the route passes, and
peeked otherwise. It confused in practice: whether a stop is on the route isn't
visible on the map, and changes with the named route. Moving your place is now a
deliberate act: C (or "Carry on from here" in the presenter window), offered only
when the route passes the stop you're looking at. A link to a stop
(`index.html#stop-id`) starts the talk there.

Looks don't draw the trail either. The lit trail records the talk as presented: the
route walked, and the detours taken. Rejoining lights the route's own trail from
where your place was, not the way back from wherever you looked, and a stop you only
looked at doesn't count as visited. If you carry on from a stop further along, the
stretch you skipped stays unlit, so the closing view of the whole trail shows what
you left out.

### 13. The presenter window follows the audience window

Press P and the deck opens a second window of itself, in presenter mode: your notes
for where the talk is, the next stop, the detours within reach (click one to take
it), a timer and clock, the route picker, and the map with the walked trail.

- **The audience window is the source of truth.** It sends where it is; the presenter
  sends back commands. The two talk by `postMessage`, which works from a file on disk
  as well as from `pathway present`, and every message carries a random token.
- **Either window takes the keys.** A clicker sends Page Down to whichever window has
  focus, so both drive the talk. B blanks the audience screen.
- **Reloads are survivable.** The audience window remembers its place for the tab
  (route, stop, walked trail), and the presenter keeps saying hello until it hears
  back, so a live reload in `pathway present` relinks by itself.

### 14. The engine: a pure core, a thin page

The browser engine is TypeScript in `src/runtime/`, in two layers:

- **A core with no DOM**, tested in Node: the map layout (`map.ts`), terrain
  (`terrain.ts`), camera framing (`camera.ts`), the timeline and flights
  (`timeline.ts`), routes, detours and rejoining (`navigator.ts`), and tours
  (`tour.ts`).
- **The page**: cards and greeking, the canvas ground and minimap, the HUD, input,
  the strip map, the presenter window, and the capture API that `render` and video
  export drive.

esbuild bundles it into `runtime/pathway.js`, which is committed, so building a deck
needs no bundler. CI checks the bundle is current. The bundle isn't minified: someone
asked to trust a page on a work machine can read it.

## The prototype (`spike/`)

A throwaway, single-file proof of the riskiest part: does the motion feel right? The
engine in `src/runtime/` replaced it as the reference renderer; it stays as a record
of how the motion was tuned. It includes:

- a tiny Markdown parser
- the curved landscape layout, and contour terrain shaped around the stations
- greek-in-place cards, and hover trail previews
- trail-following and van Wijk flights, and the lit trail
- the route, with detours and rejoin
- explore by drag, wheel and pinch, plus the minimap
- two skins in light and dark, and the remote profile
- the tour scrubber
- the strip map for small screens
- a capture tool that renders the route to MP4

Add `?view=strip` or `?view=present` to the URL to force either layout, and
`?bend=` to override the skin's curves, and `?cards=fixed` for uniform 16:10 cards.

The legend opens on first load. Inside a frame, such as the artifact viewer, keys only
reach the page after a click, and the legend's Start button provides that click.

`spike/text-zoom-lab.html` compares the zoom-text candidates described in 1a.

Run it by opening `spike/index.html` in a browser. Keys: → / ← travel, ↓ detour,
↑ pull back, M map, V tour, R remote motion, T skin, ? help.

Render the tour to video (needs ffmpeg and Playwright):

```
node spike/tools/capture.mjs --out tour.mp4 --size 1280x720 --scale 1.5
node spike/tools/capture.mjs --frames-at 0,12,40 --shots-dir shots   # stills
```

What it taught us so far:

- A card that fills the screen kills the landscape. At about 60% of the view the
  terrain, the trail and the neighbouring stations stay visible, and the talk feels
  like a place.
- Lay each card out at the size it is read, so its scale at a stop is exactly 1. Text
  is crisp where it matters, and blur during flight is invisible.
- Position every element relative to the camera in double precision each frame,
  instead of scaling one giant world container. This sidesteps the deep-zoom blur and
  jitter that limit impress.js-style decks.
- Flattening the terrain into plateaus under each station makes the contours wrap the
  content. The land looks shaped by the talk.
- The final pull-back with the walked route lit is the strongest moment, and it costs
  nothing extra to author.

From the first review:

- Tiny text invites squinting. Placeholder bars fixed that, but swapping to a larger
  glance title broke reading mid-zoom. Greeking in place fixed both.
- Fast, evenly paced moves felt like jumps. Ramped moves along the trail itself feel
  like travelling a path.
- Floating labels duplicated card titles and overlapped cards. Making the card its own
  label removed both problems.
- The presentation shrunk onto a phone didn't work, even in landscape. The strip map
  replaces it.

## Open questions

1. Should vertical video renders run the trunk south (see 10a)?
2. ~~Route syntax~~: a list of stop ids in the frontmatter. It's enough for a short
   cut of a long talk; revisit if routes need pauses or custom pull-backs.
3. Takeaway syntax: a `> takeaway:` line, or the first sentence of each trunk stop?
4. Follow link: is a relay acceptable for work talks, or personal/consultancy only?
5. Can Node run on the work machine, or does the browser-hosted compiler come first?
   A built deck needs only a browser, so building elsewhere and copying the folder
   in works today; a browser-hosted compiler would let you edit there too.
6. How far down does semantic zoom go: should diagrams have stations inside them
   ("zoom into the API Gateway box")?
7. ~~Custom skins~~: `skin: ./brand.css` in the frontmatter; see 10.

## Build plan

0. ~~Motion prototype~~ (`spike/`). Reviewed and tuned: landscape, ramped trail
   flights, greek in place, fitted cards, strip map.
1. ~~Format~~: the parser, `pathway check` with JSON diagnostics and safe fixes,
   `pathway outline`, `AGENTS.md`. `fmt` and `render --stop` are deferred to step 2,
   which brings the renderer they need.
2. ~~Present mode~~: the engine as typed modules driven by parsed decks;
   `pathway present` (local, live reload, notes), `pathway build` (an offline folder
   behind a strict content security policy), the presenter window (13), named routes,
   `fmt`, and `render`. Checked in a real browser by `npm run e2e`.
3. Explore and handoff: the phone layout, QR on the final view, takeaways.
4. Media pipeline: transcode, posters, variants, hashing, route-aware prefetch.
5. Video export: narration from notes, timing from the route. Playwright's bundled
   Chromium can't decode H.264, so capture needs WebM clips, or Chrome itself.
6. Tilt the lens: perspective camera and 2.5D trails.

## Prior art

| | What it got right | Why it isn't this |
|---|---|---|
| Prezi (2009) | The zoomable canvas | Proprietary, placed by hand, motion as decoration |
| impress.js + mdpress / Hovercraft (~2012) | Camera moves in HTML from text | Every slide hand-placed with x/y/z/rotate |
| reveal.js / Slidev / Marp | Markdown, notes, themes | At most two levels of slides; transitions are cuts |
| PowerPoint Zoom | Summary Zoom, "Return to Zoom" | Locked in .pptx, no explore mode, no text source |
| Remotion / Manim / HyperFrames | Deterministic video from code | No live, non-linear presenting |
