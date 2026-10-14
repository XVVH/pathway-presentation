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
- Speaker notes live in a sidecar, `talk.notes.md`, with matching headings. The checker
  flags notes that drift from the deck.
- Authors write text. Agents get JSON back out: the parsed tree and diagnostics with
  line numbers.

### 4. A deck is a folder, not a single file

Opening `index.html` from disk (`file://`) blocks module scripts and `fetch`. It does
**not** block `<img>`, `<video>` or fonts loaded by relative path. So:

```
my-talk/
  index.html        code, styles, and all text, inlined
  media/            images, video, fonts as plain files
```

Zip it, host it, or double-click it. `--single-file` is an opt-in for small,
image-only decks you want to email.

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
Fonts ship in `media/fonts/`. Speaker notes are never in the build unless asked for.

### 10. Skins are tokens for color, type, and motion

A skin is a CSS file of custom properties, with light and dark values. It sets palette
and typefaces, plus motion: flight speed, maximum duration, how high flights climb, the
terrain style, and how hard the trails bend (`--bend`: gentle, bold or winding). A
corporate skin moves briskly over gently curving trails; a personal one can take its
time on winding ones. The prototype ships two: **Sectional** (an aeronautical chart,
with the route drawn as the magenta line, bold curves) and **Boardroom** (gentle).

A skin changes the map's geography as well as its look: new curves, and new card
heights, since its fonts set differently. Switching skins re-lays the map.

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

### 11. Built for agents

- `pathway check` returns structural, reference and narrative diagnostics as JSON:
  broken links, missing media, notes drift, routes naming missing stops, depth beyond
  3, and too many words for one stop.
- `pathway render --stop <id>` writes a PNG, so a vision model can critique density
  and layout.
- `AGENTS.md` describes the format in a page. Since the format invents nothing, it
  stays short.
- `pathway fmt` normalizes what an LLM writes.

### 12. Stack: TypeScript

The runtime has to be JavaScript in a browser. Writing the compiler in TypeScript
lets it share types with the runtime and run in two hosts: a Node CLI for agents and
CI, and a browser page you drop a folder onto. That second host matters if Node can't
be installed on a locked-down work machine.

## The prototype (`spike/`)

A throwaway, single-file proof of the riskiest part: does the motion feel right? It
includes:

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
2. Route syntax for named routes: a list in frontmatter, or a sidecar `*.route` file?
3. Takeaway syntax: a `> takeaway:` line, or the first sentence of each trunk stop?
4. Follow link: is a relay acceptable for work talks, or personal/consultancy only?
5. Can Node run on the work machine, or does the browser-hosted compiler come first?
6. How far down does semantic zoom go: should diagrams have stations inside them
   ("zoom into the API Gateway box")?

## Build plan

0. ~~Motion prototype~~ (this commit). Review the feel, then tune.
1. Format: parser, `check` with JSON diagnostics, `fmt`, `AGENTS.md`.
2. Present mode: the engine from the prototype as a typed module, a presenter window
   with notes, timer and the detours available here, and named routes.
3. Explore and handoff: the phone layout, QR on the final view, takeaways.
4. Media pipeline: transcode, posters, variants, hashing, route-aware prefetch.
5. Video export: narration from notes, timing from the route.
6. Tilt the lens: perspective camera and 2.5D trails.

## Prior art

| | What it got right | Why it isn't this |
|---|---|---|
| Prezi (2009) | The zoomable canvas | Proprietary, placed by hand, motion as decoration |
| impress.js + mdpress / Hovercraft (~2012) | Camera moves in HTML from text | Every slide hand-placed with x/y/z/rotate |
| reveal.js / Slidev / Marp | Markdown, notes, themes | At most two levels of slides; transitions are cuts |
| PowerPoint Zoom | Summary Zoom, "Return to Zoom" | Locked in .pptx, no explore mode, no text source |
| Remotion / Manim / HyperFrames | Deterministic video from code | No live, non-linear presenting |
