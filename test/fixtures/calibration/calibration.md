---
title: Calibration
---

# Calibration
A deck that exists to measure the estimator against a real browser, with text written to land near the edges of what a stop can hold.

Every stop below stresses one part of the layout.

## A long paragraph near the limit
Most of what a presenter puts on a slide is prose, so prose is where the estimate matters most. This paragraph is long on purpose: it runs close to the most a stop can hold at reading size, so that a small error in the width of the letters or the spacing between lines would push the estimate across the line and show up here first. If the estimator and the browser agree on this card, they agree on the cards that matter, because short stops have room to spare and only long ones come near the cap. A few more words bring it closer still to the edge of the card.

## A title long enough to wrap onto a second line at reading size
Titles are set large and tight, so a second line costs more than a line of body text. This stop checks that the estimator counts title lines the way the browser breaks them.

## Bullets with lead-ins
- **Intake:** requests arrive faster than anyone triages them.
- **Triage:** the queue is ordered by whoever shouts, not by `impact`.
- **Handoff:** work changes hands three times before anyone starts it.
- **Review:** reviewers batch their reviews on Friday afternoons.
- **Deploy:** releases wait for a window that opens twice a month.
- **Measure:** nobody looks at `cycle_time` until the quarter ends.
- **Repeat:** the same stall returns, wearing a different costume.

## Code with long lines
A short lead-in, then code with lines both short and too long to fit.

```ts
const route = compileRoute(deck);
for (const stop of route) {
  camera.flyTo(stop, { ease: rampEase(0.34), duration: flightTime(stop) });
}
// This comment is deliberately much too long to fit on one line of the card at reading size.
export function flightTime(stop: Stop): number { return Math.min(3.6, 1.15 + 0.6 * screensBetween(stop)); }
```

## Side image
Images without the wide class sit in a column beside the text, so the text column is narrower and wraps into more lines than it would across the full card. This paragraph checks that narrower wrap against the browser.

![The motion grammar](media/grammar.svg)

## Side video with a caption
Video keeps a fixed sixteen by nine frame, and its caption is set in the mono face under it.

![A caption long enough to wrap across two lines of the narrow column beside the text](media/flight.mp4){loop}

### A deeper stop
Deeper stops are smaller on the map, but at their stop they're read at the same size as any other.

## An overflowing stop
This stop holds far more than a stop can show, on purpose, so the estimate of how far over the cap it runs can be checked against the browser. When a presenter writes this much, the checker should say so and suggest moving detail into the speaker notes or into child stops, because nobody in the room can read this much while also listening to the person at the front. The text keeps going well past the point where the card would have to grow beyond its cap. It describes nothing in particular; it exists to be long. Long stops are the ones the estimate has to get right, since short ones never come close to the limit. A good estimator lands within a line or two of the browser here, which is close enough to tell a presenter how much to move, and the tests will hold it to that. One more sentence for good measure, and then another, so there is no doubt at all that this card runs over.

## Wide image with text
A wide image spans the full card below the text, capped in height so a panorama doesn't take over the stop. This paragraph is long enough to wrap onto a second line.

![The motion grammar](media/grammar.svg){.wide}

## Several short paragraphs
A first paragraph that sets things up.

A second paragraph that adds a detail.

- One bullet after them
- And another to finish
