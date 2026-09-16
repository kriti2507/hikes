"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Reads are public; every write gates itself. There is no route-level gate any
// more -- proxy.ts is gone -- so requireAdmin() here is the whole boundary.

export async function setAscent(
  personId: number,
  mountainId: number,
  climbed: boolean,
  dateClimbed: string | null,
) {
  await requireAdmin();

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
  await requireAdmin();

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

function confirmPersonId(personId: number) {
  if (!Number.isSafeInteger(personId) || personId < 1) throw new Error("Invalid person");
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function updatePerson(personId: number, name: string) {
  await requireAdmin();
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

// Whether a person is shown to visitors who are not logged in. The switch is
// enforced in app/page.tsx's queries, which is the only place it can be: this
// action just records it.
//
// No revalidatePath, unlike addPerson and updatePerson. Those change the shape
// of the roster and the client has to be told; this one the client already
// knows, having painted it optimistically before the call -- and a revalidate
// would re-render a hundred rows for one checkbox.
export async function setPersonPublic(personId: number, isPublic: boolean) {
  await requireAdmin();
  confirmPersonId(personId);

  if (typeof isPublic !== "boolean") throw new Error("Invalid visibility");

  const updated = await query<{ id: number }>(
    `update people
        set is_public = $1
      where id = $2
      returning id`,
    [isPublic, personId],
  );
  if (updated.length === 0) throw new Error("Person not found");
}

export async function deletePerson(personId: number) {
  await requireAdmin();
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
