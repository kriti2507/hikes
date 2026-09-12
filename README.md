# 日本百名山 — shared checklist

A multi-person checklist for the 100 Famous Mountains of Japan (Fukada Kyūya, 1964).
Next.js + Postgres, deployed on Vercel. One page, one shared password.

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

Set `SITE_PASSWORD` in `.env.local` and in Vercel's environment variables. One
password for everyone; there are no accounts.

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

The 地図 tab draws them as triangles on a schematic outline of Japan, inked in
proportion to how many of the selected people have climbed each peak. Because
the coordinates are approximate, the map stops zooming at roughly one
prefecture — far enough in to separate neighbouring peaks, not so far that the
error becomes visible.

### Replacing the coastline

The outline is a placeholder: 88 lat/lon control points traced from named
coastal landmarks, in `db/coastline.json`. It is stored as coordinates rather
than SVG so that it goes through the same projection as the summits, which is
what keeps the triangles registered to the coast.

To swap in real geometry, convert Natural Earth or GSI data into the same shape
— rings of `[lat, lon]` under `coastline` and `prefectures`, with `source` set
to `"natural-earth"` (`scripts/build-map.mjs` checks for that exact string) —
and re-run:

```
npm run map:build
```

That rewrites `lib/map/japan-geometry.ts` and nothing else. No peak moves,
because both the outline and the summits are projected by
`lib/map/projection.mjs`. Prefecture borders are empty in the placeholder and
appear with the real geometry. Natural Earth coastlines run to hundreds or
thousands of points per ring; the script does not simplify, so the raw data
needs a simplification pass upstream of it, or the generated file becomes an
unreviewable diff.

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

## Tests

```
npm test
```

Covers the two pure modules — the Mercator projection and the marker
clustering — with Node's built-in test runner: 16 cases, from the projection's
extent corners and known summit positions to clustering's stability under
reordering and its centroid-drift edge cases. Components are verified by
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
