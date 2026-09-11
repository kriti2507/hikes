-- Hyakumeizan multi-person checklist.
--
-- Both dimensions are open-ended: a new mountain or a new person is one INSERT.
-- A missing `ascents` row already means "not climbed", so neither insert needs
-- backfilling.

create table if not exists mountains (
  id             serial primary key,
  -- Fukada's 1..100. Nullable so peaks outside the hyakumeizan (a 200-meizan
  -- summit, a local hike) can live in the same table.
  fukada_number  smallint unique,
  name_kanji     text     not null,
  name_kana      text     not null,
  name_en        text     not null,
  prefecture     text     not null,
  prefecture_ja  text     not null,
  -- Geographic north-to-south rank, copied from the printed checklist so the
  -- page groups the way the PDF does. New prefectures default to the end.
  prefecture_sort smallint not null default 999,
  region         text,
  elevation_m    integer  not null,
  best_season    text,
  notes          text,
  -- Prefectures the summit is shared with, comma separated. Free text: this is
  -- a display footnote, not something we query on.
  also_in        text,
  -- Approximate summit position. See db/coordinates.json for provenance and
  -- accuracy caveats before relying on these.
  latitude       numeric(8, 5),
  longitude      numeric(8, 5)
);

create table if not exists people (
  id         serial primary key,
  name       text    not null unique,
  sort_order smallint not null default 0
);

create table if not exists ascents (
  person_id    integer not null references people (id) on delete cascade,
  mountain_id  integer not null references mountains (id) on delete cascade,
  climbed      boolean not null default false,
  date_climbed date,
  updated_at   timestamptz not null default now(),
  primary key (person_id, mountain_id)
);

create index if not exists ascents_mountain_idx on ascents (mountain_id);
