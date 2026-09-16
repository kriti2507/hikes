# 日本百名山 — shared checklist

A multi-person checklist for the 100 Famous Mountains of Japan (Fukada Kyūya, 1964).
Next.js + Postgres, deployed on Vercel. One page, readable by anyone; edits need
the admin password.

The mountain data was extracted from `hyakumeizan-checklist.pdf`: kanji, furigana,
English name, prefecture, region, elevation, best season, and notes.

## Artwork

The header print is Katsushika Hokusai, from *Thirty-six Views of Mount Fuji*
(c. 1830). Both are public domain and were taken from Wikimedia Commons:

- `public/red-fuji.jpg` — *Fine Wind, Clear Morning* (凱風快晴), shown in light mode.
  [Source](https://commons.wikimedia.org/wiki/File:Red_Fuji_southern_wind_clear_morning.jpg)
- `public/black-fuji.jpg` — *Shower Below the Summit* (山下白雨), shown in dark mode.
  [Source](https://commons.wikimedia.org/wiki/File:Sanka_hakuu_LCCN2008660629.jpg)

They are a matched pair — the same mountain in fair weather and in storm — so
dark mode changes the weather rather than the theme. Both are resized to 1200px
wide and recompressed; replace them at that width to keep the header crop.

## Setup

### 1. Database (Neon)

In the Vercel dashboard: **Storage → Create Database → Neon**, attach it to this
project. Vercel injects `DATABASE_URL` automatically. Copy the same pooled
connection string into `.env.local` for local work.

```
cp env.example .env.local   # then fill in both values
npm install
npm run db:setup            # creates tables, loads the 100 mountains
```

`db:setup` is idempotent — re-run it any time.

### 2. Password

Set `SITE_PASSWORD` in `.env.local` and in Vercel's environment variables.

Anyone can read the checklist. To change it — tick a peak, set a date, add or
rename or delete a person — go to `/login` and enter that password. The page is
not linked from anywhere; type the URL. A visitor sees every edit control still
in place but inert, explaining itself on hover. Buttons and form fields are
dimmed; the seals in the table are not, because they are the data the page
exists to show. Either way the server rejects the write, so what a visitor sees
is an explanation rather than the lock.

Leaving `SITE_PASSWORD` unset means every request counts as the admin. That is
the local default: clone, `npm run db:setup`, `npm run dev`, edit. Set it in
production.

There are no accounts, and the password is stored as plain text in the
environment rather than hashed — it guards one person's checklist from passing
strangers, and a hash would only help against someone who can already read the
deployment's environment.

### 3. Run

```
npm run dev      # http://localhost:3000
npm run build    # what Vercel runs
```

## Deploying

Push to GitHub, import the repo in Vercel, and set the two environment
variables (`DATABASE_URL` comes from the Neon integration, `SITE_PASSWORD` you
choose). Run `npm run db:setup` once against the production database.

## Data model

```
mountains   one row per peak; fukada_number is nullable so non-hyakumeizan
            peaks can share the table
people      one row per person; each becomes a column on the page
ascents     (person_id, mountain_id) -> climbed + optional date_climbed
```

A missing `ascents` row means "not climbed", so adding a mountain or a person is
a single INSERT with no backfill.

### Adding people

Use the form at the bottom of the page, or:

```sql
insert into people (name, sort_order) values ('Kriti', 3);
update people set name = 'Kriti' where name = 'A';   -- rename a placeholder
```

### Adding mountains

```sql
insert into mountains (name_kanji, name_kana, name_en, prefecture, prefecture_ja,
                       prefecture_sort, region, elevation_m, best_season, notes,
                       latitude, longitude)
values ('槍ヶ岳', 'やりがたけ', 'Mt. Yari', 'Nagano', '長野県',
        18, 'N. Alps', 3180, 'Jul–Sep', 'chains', 36.3419, 137.6475);
```

`fukada_number` left null sorts the peak to the end of its prefecture group.
`prefecture_sort` is the geographic north-to-south rank; a new prefecture with no
value defaults to 999 and lands at the bottom.

## Coordinates and the map

`latitude` / `longitude` are populated for all 100 peaks but are **approximate**
— recorded from general knowledge, not a surveyed source, and good to roughly a
kilometre. Fine for map pins; not for navigation. See `db/coordinates.json` for
per-peak provenance.

The 地図 tab draws them as triangles on an outline of Japan, inked in
proportion to how many of the selected people have climbed each peak. Because
the coordinates are approximate, the map stops zooming at roughly one
prefecture — far enough in to separate neighbouring peaks, not so far that the
error becomes visible.

### Where the outline comes from

`db/coastline.json` holds 55 closed rings of `[lat, lon]` — Natural Earth's
1:10m admin-0 Japan, thinned for this scale. `db/prefectures.json` holds 92
open runs, the prefectural borders. Both are stored as coordinates rather than
SVG so that they go through the same projection as the summits, which is what
keeps the triangles registered to the coast. `scripts/build-map.mjs` projects
both into `lib/map/japan-geometry.ts`, which is committed:

```
npm run map:build
```

The borders are open runs rather than prefecture polygons because only the
inland lines are wanted: the coastal side of each prefecture is already drawn,
from a different provider, and a second shoreline over it in dashes would show
the two sources disagreeing as a doubled line. So a run starts and ends where
the border reaches the sea or a third prefecture, and `build-map.mjs` emits it
without a closing `Z` — which is why `.map-prefectures` sets `fill: none`.

### Re-running the conversion

`scripts/natural-earth.mjs` is the step that turns raw Natural Earth into
`db/coastline.json`. It is run by hand, not by the build, because it needs an
8MB download that is deliberately not committed or depended on:

```
npm pack world-atlas@2.0.2
tar xzf world-atlas-2.0.2.tgz
node scripts/natural-earth.mjs package/countries-10m.json
npm run map:build
```

It decodes the TopoJSON, keeps the 55 rings that fall inside the map extent and
are big enough to see (plus any island carrying a hyakumeizan, however small),
simplifies each to 0.3 map units — about 450m, finer than the source's own
accuracy — and refuses to write a file that puts a peak offshore. That
thinning is the reason it exists: raw Natural Earth is 6,942 points for Japan,
most of them detail this map cannot show, and `build-map.mjs` does not simplify.

The script's header records the checksums of the exact input used. Swapping in
Natural Earth at another scale means writing a sibling script that produces the
same `{name, points}` rings — nothing downstream changes, because both the
outline and the summits are projected by `lib/map/projection.mjs`. The history
of this file shows the swap: the placeholder it replaced was 88 hand-traced
control points, and moving to real geometry moved no triangle and changed no
component.

`scripts/prefectures.mjs` is the same step for the borders, and the sibling
script that paragraph describes. Natural Earth's admin-0 file has no
sub-national lines at all, so these come from the Geospatial Information
Authority of Japan's Global Map instead:

```
npm pack jpn-atlas@1.0.2
tar xzf jpn-atlas-1.0.2.tgz
node scripts/prefectures.mjs package/build/polbnda_jpn
npm run map:build
```

That package is used only as a mirror for the GSI shapefile inside it; its own
TopoJSON is pre-projected into an 850×680 viewport and so cannot go through
`lib/map/projection.mjs`. The source is 2,914 municipalities, not 47
prefectures, so the script recovers the borders by asking of every edge in the
file which prefectures use it: one is the coast, two the same prefecture is a
municipal line, two different ones is a border. Those edges are stitched into
runs, broken at every point where three prefectures meet, and simplified to the
same 0.3 map units as the coastline.

Two providers meet where a border lands at the sea, and they put the shoreline
in slightly different places — a few hundred metres usually, about 1.5km at
worst along the Ariake mudflats that Natural Earth smooths hardest. That is
inside the kilometre this map already claims, and `npm test` holds it there.

### Why `lib/map/*.mjs` instead of `.ts`

`projection.mjs` and `cluster.mjs` are plain JavaScript, each paired with a
hand-written `.d.mts` for TypeScript's benefit. They have three runtimes to
satisfy at once: the browser (which projects peaks out of the database),
`scripts/build-map.mjs` (which projects the coastline, run directly with
`node`), and `node --test` — and this repo's `tsconfig.json` sets
`allowJs: false`, so Node (v20 here) cannot strip types from a `.ts` file
itself. Splitting the maths into `.mjs` lets all three load it unmodified,
instead of building a separate copy for the two non-bundled runtimes.

The cost is on the TypeScript side: because the declaration file is
`projection.d.mts` (not `.d.ts`), importing callers must write the `.mjs`
extension explicitly — `import { project } from "@/lib/map/projection.mjs"` —
or the module resolver won't find the types.

`rings.mjs` has no `.d.mts` beside it because nothing in the bundle imports it:
it is shared only between the two conversion scripts and the tests.

## Tests

```
npm test
```

Node's built-in test runner, 25 cases, no framework. They cover the two pure
modules — the Mercator projection and the marker clustering — from the
projection's extent corners and known summit positions to clustering's
stability under reordering and its centroid-drift edge cases, and then the
registration invariant the map rests on: that all 100 summits in
`db/coordinates.json` fall inside a coastline ring in `db/coastline.json` when
both are projected, and that every border run in `db/prefectures.json` lands on
that same coastline rather than in the sea. Those are what would catch a
geometry swap or a coordinate edit that pushed a peak offshore, or a second
provider that had drifted away from the first. Components are verified by
running the app.

## Building

`npm run build` needs `DATABASE_URL` set to something, even a fake one:
`lib/db.ts` builds its connection pool at module load, and Next's page-data
collection imports that module while building `/` even though the route is
`force-dynamic`. The build itself never queries the database — `pg` connects
lazily — so any well-formed connection string satisfies it.

## Regenerating the data

```
node scripts/extract-pdf.mjs   # PDF -> db/pdf-rows.json
npm run db:build-seed          # + coordinates -> db/seed.sql
```

`scripts/extract-pdf.mjs` is kept for provenance; you only need it if the source
PDF changes.
