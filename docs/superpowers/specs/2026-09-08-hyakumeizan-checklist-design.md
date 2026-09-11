# Hyakumeizan shared checklist — design

Date: 2026-09-08

## Goal

A multi-person checklist for the 100 Famous Mountains of Japan, backed by
Postgres, served as one page on Vercel. First step only: an interactive map and
further features come later, so nothing here should have to be torn out to add
them.

## Decisions

| Question | Decision |
| --- | --- |
| Access | One shared password in `SITE_PASSWORD`; no user accounts |
| Database | Neon Postgres via the Vercel marketplace integration |
| Per-person record | Checkbox plus an optional date climbed |
| Adding mountains | SQL / seed script, no in-app form |

## Data source

`hyakumeizan-checklist.pdf` already contained the full table. `scripts/extract-pdf.mjs`
maps the embedded subset-font glyphs back through each font's `/ToUnicode` CMap
and parses the rows, producing `db/pdf-rows.json`: 100 rows, Fukada numbers 1–100
complete with no duplicates, across 28 prefectures.

Coordinates are not in the PDF. `db/coordinates.json` supplies them from general
knowledge, accurate to roughly a kilometre, keyed by Fukada number with the
English name repeated so a mis-keyed row is visible. They are explicitly flagged
as unverified in the README, the JSON, the schema, and the page footer, and must
be checked against GSI or OSM before the map step.

## Schema

Three tables:

- `mountains` — one row per peak. `fukada_number` is `smallint unique` but
  **nullable**, so peaks outside the hundred can share the table. `prefecture` is
  plain text, so a new prefecture needs no migration. `prefecture_sort` carries
  the printed checklist's geographic north-to-south rank and defaults to 999.
- `people` — one row per person, `sort_order` for column order.
- `ascents` — `primary key (person_id, mountain_id)`, `climbed boolean`,
  `date_climbed date` nullable.

Both dimensions expand with a single INSERT: a missing `ascents` row already
means "not climbed", so no backfill is needed when a mountain or person is added.

Ordering is `prefecture_sort, coalesce(fukada_number, 9999), name_en` so
unnumbered additions sort to the end of their prefecture group rather than
disappearing.

## Components

- `lib/db.ts` — pooled `pg` client, `max: 3` to stay inside Neon's connection
  limit across serverless invocations. Overrides the `DATE` type parser to return
  the raw `YYYY-MM-DD` string; the default builds a JS `Date` at local midnight
  and shifts the day either side of UTC.
- `lib/auth.ts` — derives the cookie token as `SHA-256("hyakumeizan-checklist:" + password)`
  via Web Crypto, so the edge proxy and the login action agree.
- `proxy.ts` — Next 16's proxy convention. Gates every path except `/login` and
  Next's asset routes. Server actions POST to the page's own path, so the same
  matcher protects them.
- `app/page.tsx` — server component, three parallel queries, `force-dynamic`.
- `app/checklist.tsx` — client component holding the whole table. Optimistic
  writes: paint, persist, roll back and show a banner on failure.
- `app/actions.ts` — `setAscent` (upsert) and `addPerson`.

## Error handling

A failed write reverts the optimistic state and shows a banner, so the UI never
claims a summit the database rejected. Unchecking clears `date_climbed`, since a
date on a not-climbed row would contradict itself. Missing `DATABASE_URL` or
`SITE_PASSWORD` throws at first use rather than failing silently.

## Verification

Typecheck and production build pass. The auth gate was exercised against a
running dev server: unauthenticated `/` and `/foo` both 307 to `/login`, `/login`
renders with a password field, a valid cookie reaches the page, and garbage and
empty cookies are rejected. Database-backed rendering is unverified — there is no
local Postgres and no credentials yet; it needs one `npm run db:setup` against a
real `DATABASE_URL`.

## Out of scope

Interactive map, per-person accounts, editing mountains in the app, photos,
trip logs.
