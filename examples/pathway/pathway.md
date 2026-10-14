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

## Decks are corridors {#corridors}
- A slide deck is one hallway: door after door, in a fixed order.
- Real ideas branch, nest, and loop back on themselves.
- The audience never sees the shape of the argument, only the next door.

### Prezi had the camera {#prezi}
A zoomable canvas in 2009. The motion was decoration, so audiences got seasick and the idea got a reputation.

### impress.js had the browser {#impress}
Camera moves in plain HTML in 2012, and tools like mdpress fed it Markdown. Every slide still needed a hand-placed x, y, z and rotation.

### PowerPoint had the return {#powerpoint .detour}
Summary Zoom and a **Return to Zoom** checkbox. Non-linear navigation, locked inside a .pptx file.

## A map and a route {#map}
The **map** is the content: every idea has a place.

The **route** is the talk: one path through the map.

### The map is computed {#computed}
There are no coordinates in the source. Main stops run along the trunk. Detail branches off as side trails, smaller and further out.

### The route is reading order {#route}
Stops follow the file from top to bottom. When a branch ends, the camera pulls back over the trail you just walked.

#### Detours wait off the route {#detours}
A detour is skipped by the route but stays one key away. Press ↓ when someone asks, then → to rejoin.

#### One map, many routes {#routes .detour}
A five-minute cut and a forty-five-minute deep dive can share one file. A route is a list of stop names.

### Explore is the map without a route {#explore}
Drag, zoom, and tap any station. On a phone, the route unrolls into a strip you scroll. This is what the audience keeps after the talk.

## How it moves {#motion}
In means detail. Out means context. Across means next. Nothing rotates.

![The motion grammar](media/grammar.svg){.wide}

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

### Notes stay private {#notes .detour}
Speaker notes live in a sidecar file with matching headings. The build leaves them out unless you ask for them.

## Where it goes {#next}
Video export, the phone handoff, and depth.

### Video from the same clock {#video}
Every frame is a function of time, so the tour renders to MP4 by stepping the clock. Embedded clips seek with it.

![An endless zoom, for old times' sake](media/flight.mp4){loop}

### Tilt the camera {#tilt}
The camera is modeled in 3D with a flat lens. Tilt it, and the trail runs toward a horizon.
