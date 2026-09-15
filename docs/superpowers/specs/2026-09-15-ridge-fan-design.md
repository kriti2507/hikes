# Fanning out a ridge that zoom cannot split

*2026-09-15 — combined spec and implementation plan*

## The problem

Three pairs of peaks can never be looked at individually. Zoom all the way
in, click the ridge that holds them, and nothing happens at all.

| Pair | Apart | Scale needed on a 600px-wide map | on 1200px |
| --- | --- | --- | --- |
| 81 Mt. Kita / 82 Mt. Ainodake | 2.9 km | 20.9 | 10.4 |
| 70 Mt. Kurodake / 71 Mt. Washiba | 2.9 km | 20.7 | 10.3 |
| 29 Mt. Hiragatake / 35 Mt. Shibutsu | 3.3 km | 17.6 | 8.8 |

`MIN_SEPARATION_PX` in `app/map/use-map-markers.ts:10` merges any two peaks
within 22 screen pixels of each other. Converting that to map units divides
by `unitsPerPixel`, which depends on how wide the map is drawn, so the
threshold in map units shrinks as the window grows. `MAX_SCALE` is 16
(`app/map/use-pan-zoom.ts:12`). On a map wider than about 900px all three
pairs clear 22px before the zoom limit and everything works. Below that they
do not, and those six peaks have no reachable card.

The click is worse than useless. `app/map/map-view.tsx:188` hands the ridge's
bounding box to `fitBounds`, which computes a target scale, clamps it to
`MAX_SCALE`, and tweens to a camera identical to the current one. The user
gets no card, no movement, and no indication that anything was even
registered.

Raising `MAX_SCALE` would paper over this. It also contradicts the reason the
cap is 16, written down at `app/map/use-pan-zoom.ts:8`: the stored
coordinates are good to about a kilometre, and past this zoom the map claims
a precision the data does not have. At 24x a kilometre of error is roughly
nine pixels — wider than the triangle meant to contain it.

## The fix

When zooming can no longer separate a ridge, clicking it fans its members
out onto short leader lines. A small hollow circle stays at the ridge's true
position; each member becomes an ordinary peak triangle a little way off it,
with its own name, its own focus ring and its own card.

This keeps the displacement honest — the anchor says "they are really here,
drawn apart so you can touch them" — and it leaves the precision argument
behind `MAX_SCALE` untouched, because nothing zooms any further.

### 1. A home for the separation rule

`MIN_SEPARATION_PX` currently lives in `app/map/use-map-markers.ts`, a
client component module that `node --test` cannot import. The fan has to
honour the same 22px rule and its test has to assert against the same
number, so move the constant to `lib/map/cluster.mjs` and export it:

```js
// Screen pixels below which two markers merge. A triangle is 14px wide, so
// this leaves a clear gap between neighbours.
export const MIN_SEPARATION_PX = 22;
```

Add it to `lib/map/cluster.d.mts` as `export declare const MIN_SEPARATION_PX:
number`, and import it in `use-map-markers.ts` in place of the local
definition. `cluster()` keeps taking `minSeparation` as an argument — it is
still a general function over points, and the constant is the map's policy
rather than the algorithm's.

### 2. `lib/map/fan.mjs`

A pure function, in its own module for the same reason `cluster.mjs` is one:
it is geometry with an invariant worth testing, and it has no business inside
a component.

```js
/** Closest a fanned member is drawn to the anchor, in screen pixels. */
export const FAN_RADIUS_PX = 28;

/** Where each of `n` fanned members sits, in screen pixels from the anchor. */
export function fanOffsets(n)
```

Both are exported so the test can assert against the same numbers the map
draws with. `lib/map/fan.d.mts` declares them for the app.

Members go on a ring, evenly spaced, the first one straight up and the rest
clockwise: `θᵢ = -π/2 + 2πi/n`. The radius is

```js
const radius = n < 2 ? FAN_RADIUS_PX : Math.max(FAN_RADIUS_PX, 14 / Math.sin(Math.PI / n));
```

The second term is what makes the guarantee: adjacent members on a ring of
radius `r` are `2r·sin(π/n)` apart, so a radius of `14/sin(π/n)` puts them
exactly 28px apart however many there are, comfortably past
`MIN_SEPARATION_PX`. Non-adjacent members are further still. The
`FAN_RADIUS_PX` floor of 28 only binds for small `n`, where the formula alone
would draw the ring too tight to the anchor to read as a fan.

For the two-member case that covers every pair in the table, this puts one
peak 28px above the anchor and one 28px below. Names extend rightward from
each triangle, and 56px of vertical separation is far more than the 9px name
row needs.

`fanOffsets(1)` returns a single offset rather than throwing; a one-member
ridge cannot occur, but the caller should not have to know that. The `n < 2`
branch is load-bearing, not defensive: `sin(π/1)` is 1.2e-16 rather than
zero, so the spacing formula alone would put a lone member 10^17 pixels from
the anchor.

### 3. When a click fans instead of zooming

`MapView` gains `fannedId: string | null`, holding the React key of the
fanned ridge — `c${members[0].mountain.id}`, already stable across renders
by `cluster.mjs`'s ordering guarantee.

The ridge's `onActivate` at `app/map/map-view.tsx:188` becomes: fan if
`scale >= MAX_SCALE`, otherwise `fitBounds` exactly as today. The rule reads
as "zoom until you can't, then fan", it needs no prediction of what a future
zoom would group, and it turns the click that currently does nothing into
the click that opens the fan.

A fan exists only at maximum zoom. An effect clears `fannedId` whenever
`scale < MAX_SCALE`, so zooming out collapses it and a fan can never be left
hanging over a crowded map. This also covers the case the `openId`
housekeeping effect at `app/map/map-view.tsx:53` handles separately — a
reclustering that dissolves the ridge — because any reclustering that
changes the grouping came from a scale change.

Collapsing also happens on Escape and on a click on the anchor circle.

### 4. Drawing it

Inside the ridge's existing transformed `<g>`, when it is the fanned one,
`ClusterMarker` is replaced by:

- `<circle className="fan-anchor" r={3} />` at the origin — hollow, hairline,
  `role="button"`, collapsing on click or Enter/Space, labelled "Draw these N
  peaks back together"
- one `<line className="fan-spoke">` per member
- one `PeakMarker` per member, translated by its offset

Fanned peaks are ordinary `PeakMarker`s with ordinary props. They get fill,
number, name, hit target, focus ring, keyboard activation and card for free,
and `peak-marker.tsx` needs no changes at all.

A spoke stops `PEAK_HEIGHT` short of the member it points to, measured along
its own ray — `k = (r - PEAK_HEIGHT) / r` applied to the offset. A triangle
rises from its anchor point back toward the circle, so a spoke drawn all the
way to that point passes through the inside of the triangle it is pointing
at. Shortening along the ray handles every direction uniformly; stopping at
the base or the apex would be right only for a member directly above or
below one. The ring radius is never under `FAN_RADIUS_PX` (28) and
`PEAK_HEIGHT` is 11, so a spoke is always at least 17px long and always
points outward.

`PEAK_HEIGHT` therefore has to be exported from `app/map/peak-marker.tsx:9`,
where the comment currently says nothing outside the module reads it. That
comment gets updated: the fan does now, and it is the same triangle either
way.

Two CSS rules in `app/globals.css`, beside the existing marker block around
line 937:

```css
/* A hairline at --sumi-faint, the weight the prefectural borders use, but
   solid: dashes here would read as another border rather than as a tether. */
.fan-spoke {
  stroke: var(--sumi-faint);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

/* Hollow, so it cannot be mistaken for a filled peak. */
.fan-anchor {
  fill: var(--washi);
  stroke: var(--sumi-faint);
  stroke-width: 1;
  cursor: pointer;
}
```

`.fan-anchor` joins `.peak, .cluster` in the `:focus-visible` and `:focus`
rules at `app/globals.css:959`.

### 5. The card

`open` at `app/map/map-view.tsx:77` resolves only from single-member
clusters. That is deliberate — the comment there explains it is what makes a
card vanish in the same render as the merge that swallowed its peak, with no
frame where a card floats over a marker that is no longer its own.

Extend it without giving that up. `open` also resolves from the members of
the fanned ridge, and carries a display position rather than just a mountain:

```ts
const open: { mountain: Mountain; x: number; y: number } | null
```

For a lone peak that is the peak's own projected position, as now. For a
fanned member it is the ridge centre plus the member's offset scaled by
`unitsPerPixel` — the card must anchor to where the triangle is drawn, not to
the centroid the ridge occupies. `cardStyle` reads `open.x` and `open.y`
unchanged.

The guarantee survives: collapsing the fan clears `fannedId`, so in that same
render `open` stops resolving and the card closes with it.

### 6. Labels and focus

`ClusterMarker`'s label at `app/map/map-view.tsx:187` currently ends "Zoom
in." At maximum zoom that is an instruction that does not work, so it becomes
"Show them separately." there.

Escape or a click on the anchor collapses the fan and returns focus to the
ridge marker that replaces it. A collapse forced by zooming out cannot do
that, since the marker under the pointer is no longer the same thing: it
rescues focus to the map surface instead, reusing the pattern and the
reasoning already at `app/map/map-view.tsx:66`.

## Tests

`test/fan.test.mjs`, over `n` from 2 to 12:

- no two offsets are closer than `MIN_SEPARATION_PX`
- no offset is nearer the anchor than `FAN_RADIUS_PX`
- the same `n` twice gives identical output, so a fan does not jitter between
  renders
- `fanOffsets(1)` returns exactly one offset
- two members sit directly above and below the anchor, the case every real
  ridge in the data hits

One test in `test/geometry.test.mjs`, over the real `db/coordinates.json`,
asserting that at least one pair of peaks cannot be separated at `MAX_SCALE`
on a 600px-wide map. That is the fact this whole feature rests on. If better
coordinates or a different extent ever make it false, the test says so rather
than leaving dead code behind. It needs `MAX_SCALE`, which lives in
`use-pan-zoom.ts` and cannot be imported from a test; the test hard-codes 16
with a comment pointing at the source, in the same spirit as the existing
geometry tests' fixed expectations.

## Out of scope

Raising `MAX_SCALE`, per the argument above. Fanning ridges below maximum
zoom, where zooming still works and is the better answer. Any change to how
names are placed — two close names can still overlap, which is the known
consequence of commit 2493d5e and is a separate piece of work.
