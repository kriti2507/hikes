# 日本百名山 — shared checklist

A multi-person checklist for the 100 Famous Mountains of Japan (Fukada Kyūya, 1964).
Next.js + Postgres, deployed on Vercel. One page, one shared password.

The mountain data was extracted from `hyakumeizan-checklist.pdf`: kanji, furigana,
English name, prefecture, region, elevation, best season, and notes.

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

## Coordinates

`latitude` / `longitude` are populated for all 100 peaks but are **approximate**
— recorded from general knowledge, not a surveyed source, and good to roughly a
kilometre. Fine for map pins; not for navigation. See `db/coordinates.json` for
per-peak provenance, and verify against GSI or OpenStreetMap before building the
interactive map.

## Regenerating the data

```
node scripts/extract-pdf.mjs   # PDF -> db/pdf-rows.json
npm run db:build-seed          # + coordinates -> db/seed.sql
```

`scripts/extract-pdf.mjs` is kept for provenance; you only need it if the source
PDF changes.
