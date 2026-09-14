# Clicking a peak opens its card

*2026-09-14 — combined spec and implementation plan*

## The problem

Clicking a mountain on the map does nothing. Pressing Enter on a focused
mountain opens its card correctly, confirmed by hand in the browser.

The card itself is not missing. `app/map/peak-card.tsx` renders the kanji,
kana and English names, elevation, prefecture, best season, notes, and a
per-person climbed checkbox with a date field. `app/map/map-view.tsx:215`
mounts it whenever `openId` resolves to a lone peak. All of that works; the
pointer path into it does not.

## Why it fails

Two independent faults in `app/map/use-pan-zoom.ts` sit on the click path.
Either would suppress a click on its own.

**Pointer capture steals the click.** `onPointerDown` calls
`setPointerCapture` on the SVG root for every press, before it can know
whether the gesture is a tap or a pan. Once the SVG holds the pointer, the
browser dispatches the following `pointerup` and the synthesized `click` to
the SVG rather than to the `<g class="peak">` under the cursor, so the
`onClick` in `app/map/peak-marker.tsx:41` never runs. Keyboard activation
takes a separate path — the `onKeyDown` on the same element — which is why
Enter works and clicking does not. This fires on every press, so it accounts
for the complete failure rate on its own.

**The drag guard is too twitchy.** `travelled` accumulates the total path
length of the pointer, not its distance from the press origin. Trackpad
jitter during an ordinary click accumulates, and once the total crosses
`DRAG_SLOP` (5px) the `onClickCapture` guard in `app/map/map-view.tsx:152`
treats the gesture as a pan and calls `stopPropagation()`. This one is
intermittent rather than total, and would survive a fix to the first.

## The fix

Both changes are confined to `app/map/use-pan-zoom.ts`. No component
boundaries move, no props change, and `PeakMarker` and `PeakCard` are
untouched.

### 1. Capture the pointer only once a drag is real

Move `setPointerCapture` out of `onPointerDown` and into `onPointerMove`,
fired once at the moment travel first crosses `DRAG_SLOP`.

A tap never captures, so its `pointerup` and `click` reach the marker the
normal way. A pan captures as soon as it is recognisably a pan, which
preserves the reason capture is there: a drag that wanders off the edge of
the SVG keeps panning instead of stalling. The window between press and the
5px threshold is small enough that a real drag is captured within a frame or
two.

`onPointerDown` keeps everything else it does — cancelling any fit tween,
recording the pointer, and resetting `travelled`, `dragged` and `pinchStart`.

### 2. Measure displacement from the press origin, not path length

Store the press position per pointer and set `travelled` to the largest
distance the pointer has reached from that origin, rather than summing each
move's length.

Maximum displacement rather than current displacement, so that a pan which
wanders out and returns to its starting point still counts as a drag — a
gesture that covered half the country should not open whichever peak happens
to sit under the release point.

Jitter during a click stays within a pixel or two of the origin and so stays
below the threshold, while any deliberate pan passes it immediately. The
existing `DRAG_SLOP` value of 5px still reads correctly under the new
meaning, and both `wasDragged()` and the pinch path continue to work
unchanged, since a pinch moves both pointers well past 5px.

## Accepted edge case

Without capture on press, a gesture that presses on the map, moves less than
5px, and releases with the pointer outside the SVG leaves a stale entry in
the hook's `pointers` map, because the `pointerup` never reaches the element.
The next single-pointer drag would then see two tracked pointers and be read
as a pinch.

Reaching this requires pressing within 5px of the map's edge and slipping
out before release. It is left unhandled rather than guarded: the guard costs
a window-level listener and its own teardown, which is more machinery than
the case earns. A subsequent `pointerdown` and `pointercancel` both already
reset the surrounding state.

## Verification

Automated coverage is not available here. The repo's tests
(`node --test test/*.test.mjs`) cover projection, clustering and geometry —
pure functions over data — and there is no DOM harness, no headless browser
and no test that renders a component. Adding one for this would mean
introducing a browser test stack, which is out of proportion to a two-part
change in one file.

So the check is by hand, in the browser, on the map tab:

1. Click a mountain triangle. Its card opens.
2. Click a second lone mountain. The first card closes, the second opens.
3. Press and drag across a peak, releasing over it. No card opens.
4. Drag out and back, releasing near the press point over a peak. No card
   opens.
5. Tab to a mountain and press Enter. The card still opens, as before.
6. Pinch or wheel to zoom, and drag to pan. Both behave as before.
7. Drag from inside the map and continue past its edge. Panning continues.
8. With a card open, press Escape, click its ×, and click outside it. Each
   closes the card. Focus restore is expected to fail here — see below.

Then `npm run typecheck` and `npm test` to confirm nothing else moved.

## Noticed while diagnosing, not fixed here

`PeakCard` captures the element to restore focus to with
`document.activeElement instanceof HTMLElement`
(`app/map/peak-card.tsx:32`). A focused peak marker is an `SVGGElement`,
which inherits from `SVGElement`, not `HTMLElement` — so the guard rejects
it, `previouslyFocused` stays null, and closing the card restores focus to
nothing. `focus()` is available on both, via the `HTMLOrSVGElement` mixin,
so the guard is simply too narrow.

This predates the click bug and affects the keyboard path that works today:
open a card with Enter, press Escape, and focus lands on `<body>` rather
than back on the marker. It is left out of this change to keep the fix to
one file and one concern. Worth picking up next, as a one-line widening of
the guard.

## Out of scope

**The card's contents.** They stay exactly as they are. Once clicking works,
the real card is visible in the browser and can be judged on its merits;
changing it now would mean redesigning something nobody has seen yet.

**Peak labels on the map.** Names appear on some mountains and not others by
design: `app/map/map-view.tsx:166` draws a label only at zoom 6 or above and
only when the peak has at least `NAME_ROOM_PX` (150px) of clearance to its
nearest neighbour, so labels cannot collide. This is working as intended and
is a separate question from the card.
