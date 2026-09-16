import { query } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { Checklist, type Ascent, type Mountain, type Person } from "./checklist";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Awaited before the queries rather than alongside them: two of the three
  // take it as a parameter. A person with is_public false is not filtered out
  // in the browser -- they are never sent to it. Hiding a column in React
  // would leave the name and every ascent sitting in the page source, which is
  // the one thing this switch exists to prevent.
  const admin = await isAdmin();

  const [mountains, people, ascents] = await Promise.all([
    query<Mountain>(
      `select id,
              fukada_number  as "fukadaNumber",
              name_kanji     as "nameKanji",
              name_kana      as "nameKana",
              name_en        as "nameEn",
              prefecture,
              prefecture_ja  as "prefectureJa",
              region,
              elevation_m    as "elevationM",
              best_season    as "bestSeason",
              notes,
              also_in        as "alsoIn",
              -- pg hands back numeric columns as strings, which would put every
              -- triangle at NaN. The cast is not optional.
              latitude::float8  as latitude,
              longitude::float8 as longitude
         from mountains
        -- Unnumbered additions sort to the end of their prefecture group.
        order by prefecture_sort, coalesce(fukada_number, 9999), name_en`,
    ),
    query<Person>(
      // The cast is not decoration: pg sends a parameter with no declared type
      // and leaves Postgres to infer it from context, so naming the type here
      // is what keeps `$1 or is_public` from depending on that inference.
      `select id, name, is_public as "isPublic"
         from people
        where $1::boolean or is_public
        order by sort_order, id`,
      [admin],
    ),
    query<Ascent>(
      `select person_id   as "personId",
              mountain_id as "mountainId",
              climbed,
              date_climbed as "dateClimbed"
         from ascents
        where (climbed or date_climbed is not null)
          -- Not redundant with the people query above, which only decides who
          -- gets a column. An ascent row carries no name, but it carries a
          -- private person's id, their count and exactly which peaks -- the
          -- part that is actually private.
          and person_id in (select id from people where $1::boolean or is_public)`,
      [admin],
    ),
  ]);

  return <Checklist mountains={mountains} people={people} ascents={ascents} isAdmin={admin} />;
}
