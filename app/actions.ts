"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

// Reachable only behind middleware.ts, which covers server-action POSTs to "/"
// because they use the page's own path.

export async function setAscent(
  personId: number,
  mountainId: number,
  climbed: boolean,
  dateClimbed: string | null,
) {
  await query(
    `insert into ascents (person_id, mountain_id, climbed, date_climbed)
     values ($1, $2, $3, $4)
     on conflict (person_id, mountain_id) do update
       set climbed = excluded.climbed,
           date_climbed = excluded.date_climbed,
           updated_at = now()`,
    [personId, mountainId, climbed, dateClimbed || null],
  );
}

export async function addPerson(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  await query(
    `insert into people (name, sort_order)
     values ($1, coalesce((select max(sort_order) from people), 0) + 1)
     on conflict (name) do nothing`,
    [trimmed],
  );
  revalidatePath("/");
}
