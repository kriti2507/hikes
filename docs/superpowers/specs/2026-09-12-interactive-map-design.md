# Interactive schematic map

Date: 2026-09-12

A zoomable schematic map of Japan alongside the checklist: one triangle per peak,
inked in proportion to how many of the selected people have climbed it, clustering
into ridges when peaks collide on screen.

The reference is a printed hyakumeizan location sheet — an outline of Japan with
numbered triangles and a blown-up "Central Honshu" inset. We keep the triangles and
drop the inset, because that inset only exists to work around paper's inability to
zoom.

## Scope

| File | Change |
| --- | --- |
| `lib/map/projection.mjs` | New — `project(lat, lon)`, extent constants |
| `lib/map/projection.d.ts` | New — types for the above |
| `lib/map/cluster.mjs` | New — deterministic screen-distance clustering |
| `lib/map/cluster.d.ts` | New — types for the above |
| `lib/map/japan-geometry.ts` | New, **generated** — path data, viewBox, source tag |
| `db/coastline.json` | New — placeholder outline as lat/lon control points |
| `scripts/build-map.mjs` | New — source geometry → `lib/map/japan-geometry.ts` |
| `app/map/map-view.tsx` | New — the SVG surface |
| `app/map/peak-marker.tsx` | New — one triangle |
| `app/map/cluster-marker.tsx` | New — the ridge |
| `app/map/peak-card.tsx` | New — detail panel with per-person ticks |
| `app/map/person-filter.tsx` | New — the person chips |
| `app/map/use-pan-zoom.ts` | New — wheel / drag / pinch → viewBox |
| `app/checklist.tsx` | Reduced to a container: shared state, tabs |
| `app/banner.tsx` | New — extracted header, tally, `PersonActions` |
| `app/checklist-table.tsx` | New — extracted table |
| `app/add-person.tsx` | New — extracted `AddPerson` |
| `app/page.tsx` | Query gains `latitude`, `longitude` |
| `app/globals.css` | Map styles |
| `test/projection.test.mjs` | New |
| `test/cluster.test.mjs` | New |
| `package.json` | `"test": "node --test test/*.test.mjs"` |
| `README.md` | Map section; coordinate caveat updated |

No runtime dependency is added. No schema change.

## The rule

**Ink level = how many of the ticked people have climbed it ÷ how many you ticked.**

One rule, no modes. Every case falls out of it:

| Ticked | Result |
| --- | --- |
| Nobody | Every triangle hollow |
| One person | Plain filled / hollow — that person's map |
| Two people | Hollow, half, solid |
| Everyone | Solid means "all of us" |

Rejected: separate "all of them" and "any of them" modes. Both are readable off the
graded map — solid is *all*, any ink at all is *at least one* — and the graded form
additionally shows "some but not all", which a mode switch hides.

All people are ticked by default. The selection lives in component state; it is not
persisted or reflected in the URL.

A count beside the chips restates the rule in words, so the map is never ambiguous
about what is being shown. The phrasing follows the selection: "62 of 100 climbed by
Kriti", "…by both", "…by all 3", and "nobody selected" when the map is blank.

## Symbols

**Peak.** Triangle, `--sumi` hairline outline on `--washi`, filled `--beni` from the
base upward. Vermilion rather than Prussian blue because it is the same ink as the
seal pressed in the table: a filled triangle and a stamped checkbox mean the same
thing.

**Fill geometry.** The fill is a `<rect>` clipped to the triangle, rising from the
base — proportional to *height*, not area. Height reads as a water level; area-
proportional fill puts the half mark uncomfortably low and is illegible at a 14px
symbol. This is a deliberate inaccuracy in a symbol that is read, not measured.

**Cluster.** Two overlapping triangles — a ridge — with the member count set beside
them, filled from the base by the fraction of member peaks that *every* ticked person
has climbed. Rejected: one larger triangle (reads as a single big mountain until you
read the number) and a round seal (unmistakable, but introduces a second shape
language and abandons fill-from-the-base exactly where the overview matters most).

A cluster of one renders as a plain peak.

**Labels.** A peak shows its Fukada number once it is no longer inside a cluster, and
its English name as well above 6× zoom. Because clustering guarantees a minimum screen
separation, labels cannot collide.

## Interaction

- **Click a peak** → card: kanji, kana, English name, elevation, prefecture, best
  season, notes, and one tick box per person with its date. Climbs can be marked from
  here. Closes on outside click or `Escape`.
- **Click a ridge** → zoom to fit its members, with padding.
- **Zoom** → `+` / `−` / 全図 (fit all), wheel, drag, pinch.

## Zoom limits and coordinate honesty

`README.md` records that the stored coordinates are approximate to roughly a
kilometre and warns against building a map on them unverified. We honour that rather
than re-surveying 100 peaks:

- Minimum zoom fits the whole extent.
- **Maximum zoom is 16×**, roughly one prefecture filling the view. At that scale a
  kilometre is about 4px against a 14px triangle, so the error stays visibly inside
  the symbol and the map never implies precision the data lacks.
- A standing note under the map reads "Summit positions are approximate — good to
  about a kilometre."

Panning is clamped so the projected extent always intersects the viewport.

## Architecture

### Projection is the fixed point

The outline is a placeholder today and real geometry later. If the artwork and the
peak positions came from different coordinate systems, swapping the artwork would
slide all 100 triangles off the map. So the projection is fixed and the artwork plugs
into it.

`lib/map/projection.mjs` exports a pure spherical Mercator over a fixed extent:

```
LON_MIN 128.5   LON_MAX 146.5
LAT_MIN  30.0   LAT_MAX  45.8
```

The stored peaks span latitude 30.33 (Mt. Miyanoura) to 45.18 (Mt. Rishiri) and
longitude 130.51 (Mt. Miyanoura) to 145.12 (Mt. Rausu), so this extent covers all 100
with margin on every side.

`project(lat, lon) → {x, y}` maps into a viewBox 1000 units wide. The height follows
from the Mercator aspect — **1120.30** — and is computed from the constants rather
than hardcoded, so changing the extent cannot silently distort the map.

**Peaks are projected at runtime from the database. The outline is projected at build
time from whatever source the script is pointed at. Both call the identical function
with the identical extent, so they are registered to each other by construction.**

### Swapping the geometry

```
db/coastline.json        ─┐
  (today: ~80 lat/lon     │
   control points)        ├─→ scripts/build-map.mjs ─→ lib/map/japan-geometry.ts
Natural Earth TopoJSON   ─┘        (uses projection.mjs)
  (later: coastline +
   prefecture borders)
```

`lib/map/japan-geometry.ts` is generated and exports:

```ts
export const coastline: string[]      // SVG path data
export const prefectures: string[]    // SVG path data, may be empty
export const viewBox: string
export const source: "placeholder" | "natural-earth"
```

Replacing the placeholder means pointing the script at Natural Earth and re-running
it. **One generated file changes.** No component, no peak position, and no test
changes. The `source` tag exists so the footnote can say which is in use.

The placeholder is stored as lat/lon control points rather than SVG so that it too
goes through `project()` — it is registered to the real world, not eyeballed against
the triangles.

Hand-tracing 47 prefecture boundaries as lat/lon control points is not a reasonable
use of effort for artwork that is about to be thrown away, so the placeholder ships
`prefectures: []` and the map must render cleanly with it empty.

**Correction, after the swap:** this section originally claimed prefecture borders
would arrive with the real geometry. They did not. Natural Earth's admin-0 countries
file — the one the coastline came from — has no sub-national lines at all; the dotted
internal borders of the reference sheet need its separate admin-1 states and provinces
layer. `prefectures: []` outlived the placeholder, and the map still has to render
cleanly with it empty.

### Why `.mjs` for the pure modules

`projection` and `cluster` have to run in three places: the browser, `build-map.mjs`,
and `node --test`. The project is on Node 20, which has no TypeScript stripping, and
`tsconfig.json` sets `allowJs: false`. Plain `.mjs` with a hand-written `.d.ts`
beside it gives full types to the app while letting the script and the test runner
import the same file with no transpiler and no tsconfig change. React components stay
`.tsx`.

If the paired `.d.ts` proves awkward in practice, the fallback is `allowJs: true`
with JSDoc types. Duplicating the projection maths into two files is **not** an
acceptable fallback — a drift between them is precisely the bug this design exists to
prevent.

### Clustering

`cluster(points, minSeparation) → Cluster[]`, pure and deterministic.

Peaks are visited in a fixed order — ascending `fukadaNumber`, nulls last, then `id`.
Each joins the first existing cluster whose centroid lies within `minSeparation`,
otherwise starts its own. Determinism matters: a clustering that reshuffles between
renders makes the map flicker while zooming.

`minSeparation` is `22 × unitsPerPixel` — 22 screen pixels expressed in map units,
against a 14px triangle — so clustering keys off **screen distance, not zoom level**. Clusters therefore split
smoothly as you zoom rather than popping at fixed thresholds, and no two triangles
ever sit invisibly on top of each other. The result is memoised on `unitsPerPixel`,
so panning does not recompute it. n = 100 makes the cost irrelevant either way.

### Pan and zoom

`use-pan-zoom.ts` owns `{x, y, scale}`, derives the `viewBox` and `unitsPerPixel`,
and handles wheel, drag and pinch through Pointer Events. It clamps scale between fit
and 16×, and clamps translation as described above. Zoom-to-cursor and zoom-to-cluster
both go through the same "fit this rectangle" entry point.

### Component structure

`checklist.tsx` is currently 365 lines doing five jobs. It becomes a container:

- `app/checklist.tsx` — owns `entries`, `save()`, the active tab, and the person
  selection; renders `Banner`, the tab strip, and either the table or the map
- `app/banner.tsx` — header print, tallies, `PersonActions`
- `app/checklist-table.tsx` — the table
- `app/add-person.tsx` — `AddPerson`
- `app/map/*` — map surface, markers, card, filter, hook

`app/map/` deliberately contains no `page.tsx`, so it is a component directory and
not a route.

The map and the table call the same `save()`, so optimistic-write-then-roll-back
stays in one implementation and a tick made on the map is already reflected in the
table when you flip tabs. No refetch happens on tab switch: `page.tsx` already loads
every mountain, person and ascent in one pass.

## Data

`app/page.tsx` gains two columns:

```sql
latitude::float8   as latitude,
longitude::float8  as longitude
```

**The cast is required.** `pg` returns `numeric` columns as strings, so
`numeric(8,5)` arrives as `"35.36072"` and every triangle would be positioned at
`NaN` without it. `Mountain` gains `latitude: number | null` and
`longitude: number | null`.

Peaks with a null coordinate are excluded from the map and reported under it
("2 peaks have no coordinates yet"), never silently dropped. The schema permits
nulls even though all 100 rows currently have values.

## Testing

The repository has no test framework. `node --test` is built into Node 20 and adds no
dependency, which suits a project whose runtime dependencies are `next`, `react` and
`pg` and nothing else.

Only the pure modules are tested — they are where the subtle bugs live, and they are
testable without a browser:

- **`projection`** — known summits land at their expected coordinates; the extent
  corners map to the viewBox corners; longitude is monotonic in x and latitude
  monotonic in y; aspect ratio matches the Mercator derivation.
- **`cluster`** — identical input yields identical output; a large `minSeparation`
  collapses everything to one cluster and zero leaves every peak singular; members
  are partitioned exactly once; ordering is independent of input array order.

Components are not unit-tested. Verification of the map itself is by running it.

## Accessibility

- The **table view is the complete accessible equivalent**; nothing is reachable only
  through the map.
- Peaks are keyboard-focusable in Fukada order (the same order clustering visits
  them in, so the tie-break stays stable while tabbing), with descriptive labels
  ("Mt. Fuji, 3,776 m, climbed by Kriti and Ami"). This is not the table's order —
  the table groups by prefecture — but the table remains the complete accessible
  equivalent regardless of ordering, so nothing is lost by the two disagreeing.
  The tab strip precedes the peaks, so tabbing past 100 triangles is avoidable.
- Colour is never the sole channel: fill level is a shape difference, the card names
  people in text, and the header restates the count in words.
- `prefers-reduced-motion` disables zoom animation.
- Every colour comes from the existing `--washi` / `--sumi` / `--beni` / `--rule`
  tokens, so dark mode works with no map-specific palette.

## Out of scope

- ~~Replacing the placeholder coastline with Natural Earth geometry — the pipeline is
  built for it, the swap is a later task.~~ **Done.** `scripts/natural-earth.mjs`
  converts Natural Earth 1:10m admin-0 (via `world-atlas@2.0.2`) into
  `db/coastline.json`: 55 rings, 3,323 points, simplified to 0.3 map units. The
  prediction above held — one generated file changed, no component and no peak
  position — with two exceptions worth recording. The caption branching on `source`
  had to become a lookup, because a `source === "placeholder"` comparison stops
  type-checking once the generated value is the other one. And the raw data needed a
  simplification step, which `build-map.mjs` deliberately does not do, so the swap
  added a script rather than only changing a file.
- Verifying the 100 coordinates against GSI or OpenStreetMap.
- Routes, trails, or anything requiring precision the data does not have.
- Sharing a map view by URL.
- The "Central Honshu" inset from the reference sheet.
