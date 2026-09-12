import { query } from "@/lib/db";
import { Checklist, type Ascent, type Mountain, type Person } from "./checklist";

export const dynamic = "force-dynamic";

export default async function Page() {
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
    query<Person>(`select id, name from people order by sort_order, id`),
    query<Ascent>(
      `select person_id   as "personId",
              mountain_id as "mountainId",
              climbed,
              date_climbed as "dateClimbed"
         from ascents
        where climbed or date_climbed is not null`,
    ),
  ]);

  return <Checklist mountains={mountains} people={people} ascents={ascents} />;
}
