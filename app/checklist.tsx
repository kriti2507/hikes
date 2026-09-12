"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setAscent } from "./actions";
import { AddPerson } from "./add-person";
import { Banner } from "./banner";
import { ChecklistTable } from "./checklist-table";

// Re-exported from here rather than a types file because app/page.tsx already
// imports them from this path, and moving them would churn that import for no
// gain. Type aliases rather than interfaces: aliases get an implicit index
// signature, which is what lib/db.ts's `query<T>` constraint wants.
export type Mountain = {
  id: number;
  fukadaNumber: number | null;
  nameKanji: string;
  nameKana: string;
  nameEn: string;
  prefecture: string;
  prefectureJa: string;
  region: string | null;
  elevationM: number;
  bestSeason: string | null;
  notes: string | null;
  alsoIn: string | null;
  // Approximate to roughly a kilometre; see db/coordinates.json. Nullable
  // because the schema allows a mountain to be added without a position.
  latitude: number | null;
  longitude: number | null;
};

export type Person = { id: number; name: string };

export type Ascent = {
  personId: number;
  mountainId: number;
  climbed: boolean;
  dateClimbed: string | null;
};

export type Entry = { climbed: boolean; dateClimbed: string | null };

export const key = (personId: number, mountainId: number) => `${personId}:${mountainId}`;

export function Checklist({
  mountains,
  people,
  ascents,
}: {
  mountains: Mountain[];
  people: Person[];
  ascents: Ascent[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      ascents.map((a) => [key(a.personId, a.mountainId), { climbed: a.climbed, dateClimbed: a.dateClimbed }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const out = new Map<number, number>(people.map((p) => [p.id, 0]));
    for (const person of people) {
      let n = 0;
      for (const m of mountains) if (entries[key(person.id, m.id)]?.climbed) n++;
      out.set(person.id, n);
    }
    return out;
  }, [entries, people, mountains]);

  // Optimistic: paint the change, then persist. Roll back on failure so the UI
  // never claims a summit the database rejected.
  function save(personId: number, mountainId: number, next: Entry) {
    const k = key(personId, mountainId);
    const previous = entries[k] ?? { climbed: false, dateClimbed: null };
    setEntries((current) => ({ ...current, [k]: next }));
    setError(null);

    setAscent(personId, mountainId, next.climbed, next.dateClimbed).catch(() => {
      setEntries((current) => ({ ...current, [k]: previous }));
      setError("Could not save that change. Check your connection and try again.");
    });
  }

  return (
    <main>
      <Banner
        people={people}
        counts={counts}
        total={mountains.length}
        onChanged={() => router.refresh()}
      />

      <div className="sheet">
        {error ? <p className="error banner-error">{error}</p> : null}

        {people.length === 0 ? (
          <p className="empty">No people yet — add someone below to start a column.</p>
        ) : null}

        <ChecklistTable mountains={mountains} people={people} entries={entries} onSave={save} />

        <AddPerson onAdded={() => router.refresh()} />

        <footer>
          Coordinates in the database are approximate (see <code>db/coordinates.json</code>). Add mountains with SQL
          against the <code>mountains</code> table.
          <p className="credit">
            Header print: Katsushika Hokusai, <i>Fine Wind, Clear Morning</i> (c. 1830) by day and{" "}
            <i>Shower Below the Summit</i> (c. 1830) after dark, from <i>Thirty-six Views of Mount Fuji</i>. Public
            domain, via Wikimedia Commons.
          </p>
        </footer>
      </div>
    </main>
  );
}
