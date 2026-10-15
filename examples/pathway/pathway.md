---
title: Pathway
skin: sectional
density: talk
routes:
  exec: [corridors, map, motion, next]
  format-only: [format, notes]
---

# Pathway
A talk you travel through instead of paging through.

::: takeaways
- A deck is a map; the talk is one route through it.
- Write it as plain Markdown. Pathway lays out the map.
- Detours answer questions without losing your place.
:::

::: notes
Open on the whole map and let it sit for a beat. Say: "This is everything we'll cover today. We'll walk it, then come back up here at the end."
:::

## Decks are corridors {#corridors}
- A slide deck is one hallway: door after door, in a fixed order.
- Real ideas branch, nest, and loop back on themselves.
- The audience never sees the shape of the argument, only the next door.

::: notes
Ask the room how many decks they've sat through this week. The point isn't that slides are bad; it's that a fixed order hides the shape of the argument.
:::

### Prezi had the camera {#prezi}
A zoomable canvas in 2009. The motion was decoration, so audiences got seasick and the idea got a reputation.

::: notes
Credit where it's due: Prezi proved people want to move through ideas spatially. It lost the room by moving for the sake of moving.
:::

### impress.js had the browser {#impress}
Camera moves in plain HTML in 2012, and tools like mdpress fed it Markdown. Every slide still needed a hand-placed x, y, z and rotation.

::: notes
This is probably the tool someone remembers from 2012. Authoring was the problem: every slide needed coordinates by hand.
:::

### PowerPoint had the return {#powerpoint .detour}
Summary Zoom and a **Return to Zoom** checkbox. Non-linear navigation, locked inside a .pptx file.

::: notes
Only if someone asks "can't PowerPoint already do this?" Yes, Summary Zoom gets surprisingly close. What it can't do is live outside a .pptx.
:::

## A map and a route {#map}
The **map** is the content: every idea has a place.

The **route** is the talk: one path through the map.

::: notes
The one idea to land: the content is a place, and the talk is one way through it. Everything else follows from separating them.
:::

### The map is computed {#computed}
There are no coordinates in the source. Main stops run along the trunk. Detail branches off as side trails, smaller and further out.

### The route is reading order {#route}
Stops follow the file from top to bottom. When a branch ends, the camera pulls back over the trail you just walked.

::: notes
Point out that nobody wrote any transitions. The file's order is the route.
:::

#### Detours wait off the route {#detours}
A detour is skipped by the route but stays one key away. Press ↓ when someone asks, then → to rejoin.

::: notes
Demonstrate live: press ↓ here, then → to come back. Let them see the camera rejoin.
:::

#### One map, many routes {#routes .detour}
A five-minute cut and a forty-five-minute deep dive can share one file. A route is a list of stop names.

### Explore is the map without a route {#explore}
Drag, zoom, and tap any station. On a phone, the route unrolls into a strip you scroll. This is what the audience keeps after the talk.

## How it moves {#motion}
In means detail. Out means context. Across means next. Nothing rotates.

![The motion grammar](media/grammar.svg){.wide}

::: notes
Keep this short. The grammar is easier to feel than explain, and they've been feeling it for ten minutes already.
:::

### Follow the trail {#flights}
Between neighbouring stops the camera rides the trail itself, easing in and out. Longer jumps climb toward the ground the two ends share, then descend.

Path: van Wijk and Nuij, *Smooth and efficient zooming and panning*, 2003.

### Remote mode {#remote}
Screen-share encoders drop frames when everything moves at once. Press R for shorter, flatter flights over plain ground.

## How it's written {#format}
One Markdown file. Headings are stations, and heading depth is distance from the trunk.

```markdown
## Intake {#intake}
![Funnel](media/funnel.svg)

### Triage is a queue {.detour}
Skipped by the route. One key away.
```

::: notes
If the audience is technical, open the source file next to the map. If not, skip straight to the next stop.
:::

### Notes stay private {#notes .detour}
Speaker notes sit under their stop, between `::: notes` and `:::`, so they move when it moves. The build leaves them out unless you ask.

## Where it goes {#next}
Video export, the phone handoff, and depth.

::: notes
Close by pulling back to the whole map. Then show the QR code and hand them the map.
:::

### Video from the same clock {#video}
Every frame is a function of time, so the tour renders to MP4 by stepping the clock. Embedded clips seek with it.

![An endless zoom, for old times' sake](media/flight.mp4){loop}

::: notes
The clip on screen was rendered by stepping the same clock the live talk uses. No screen recording involved.
:::

### Tilt the camera {#tilt}
The camera is modeled in 3D with a flat lens. Tilt it, and the trail runs toward a horizon.
