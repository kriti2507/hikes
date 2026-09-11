"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { sitePassword } from "@/lib/auth";

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

function confirmPassword(password: unknown) {
  if (typeof password !== "string" || password !== sitePassword()) throw new Error("Wrong password");
}

function confirmPersonId(personId: number) {
  if (!Number.isSafeInteger(personId) || personId < 1) throw new Error("Invalid person");
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function updatePerson(personId: number, name: string, password: string) {
  confirmPassword(password);
  confirmPersonId(personId);

  if (typeof name !== "string") throw new Error("Name is required");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  let updated: { id: number }[];
  try {
    updated = await query<{ id: number }>(
      `update people
          set name = $1
        where id = $2
        returning id`,
      [trimmed, personId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("A person with that name already exists");
    throw error;
  }
  if (updated.length === 0) throw new Error("Person not found");

  revalidatePath("/");
}

export async function deletePerson(personId: number, password: string) {
  confirmPassword(password);
  confirmPersonId(personId);

  const deleted = await query<{ id: number }>(
    `delete from people
      where id = $1
      returning id`,
    [personId],
  );
  if (deleted.length === 0) throw new Error("Person not found");

  revalidatePath("/");
}
