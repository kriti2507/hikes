"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPerson, setAscent } from "./actions";

// Type aliases rather than interfaces: aliases get an implicit index signature,
// which is what lib/db.ts's `query<T>` constraint wants.
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
};

export type Person = { id: number; name: string };

export type Ascent = {
  personId: number;
  mountainId: number;
  climbed: boolean;
  dateClimbed: string | null;
};

type Entry = { climbed: boolean; dateClimbed: string | null };

const key = (personId: number, mountainId: number) => `${personId}:${mountainId}`;

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

  // Mountains arrive pre-sorted, so grouping is a single pass that preserves
  // the prefecture order the query chose.
  const groups = useMemo(() => {
    const out: { prefecture: string; prefectureJa: string; mountains: Mountain[] }[] = [];
    for (const m of mountains) {
      const last = out.at(-1);
      if (last?.prefecture === m.prefecture) last.mountains.push(m);
      else out.push({ prefecture: m.prefecture, prefectureJa: m.prefectureJa, mountains: [m] });
    }
    return out;
  }, [mountains]);

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
      <header>
        <h1>
          日本百名山
          <span>The 100 Famous Mountains of Japan · Fukada Kyūya, 1964</span>
        </h1>
        <ul className="tally">
          {people.map((person) => (
            <li key={person.id}>
              <strong>{counts.get(person.id) ?? 0}</strong>
              <span>
                {person.name} · of {mountains.length}
              </span>
            </li>
          ))}
        </ul>
      </header>

      {error ? <p className="error banner">{error}</p> : null}

      {people.length === 0 ? (
        <p className="empty">No people yet — add someone below to start a column.</p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th className="mountain">Mountain</th>
            <th className="elev">Height</th>
            <th className="season">Best time</th>
            <th className="notes">Notes</th>
            {people.map((person) => (
              <th key={person.id} className="person">
                {person.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.prefecture}>
              <tr className="group">
                <th colSpan={5 + people.length}>
                  {group.prefectureJa}
                  <span>
                    {group.prefecture} · {group.mountains.length}
                  </span>
                </th>
              </tr>
              {group.mountains.map((m) => (
                <tr key={m.id}>
                  <td className="num">{m.fukadaNumber ?? "—"}</td>
                  <td className="mountain">
                    <span className="kanji">{m.nameKanji}</span>
                    <span className="kana">{m.nameKana}</span>
                    <span className="en">{m.nameEn}</span>
                  </td>
                  <td className="elev">{m.elevationM.toLocaleString("en-US")} m</td>
                  <td className="season">{m.bestSeason ?? "—"}</td>
                  <td className="notes">
                    {[m.region, m.notes, m.alsoIn && `also ${m.alsoIn}`].filter(Boolean).join(" · ")}
                  </td>
                  {people.map((person) => {
                    const entry = entries[key(person.id, m.id)];
                    const climbed = entry?.climbed ?? false;
                    return (
                      <td key={person.id} className="person">
                        <input
                          type="checkbox"
                          checked={climbed}
                          aria-label={`${person.name} climbed ${m.nameEn}`}
                          onChange={(event) =>
                            save(person.id, m.id, {
                              climbed: event.target.checked,
                              // Unchecking discards the date: the row means
                              // "not climbed", so a date would contradict it.
                              dateClimbed: event.target.checked ? (entry?.dateClimbed ?? null) : null,
                            })
                          }
                        />
                        {climbed ? (
                          <input
                            type="date"
                            className="date"
                            value={entry?.dateClimbed ?? ""}
                            aria-label={`Date ${person.name} climbed ${m.nameEn}`}
                            onChange={(event) =>
                              save(person.id, m.id, { climbed: true, dateClimbed: event.target.value || null })
                            }
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <AddPerson onAdded={() => router.refresh()} />

      <footer>
        Coordinates in the database are approximate (see <code>db/coordinates.json</code>). Add mountains with SQL
        against the <code>mountains</code> table.
      </footer>
    </main>
  );
}

function AddPerson({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <form
      className="add-person"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setFailed(false);
        startTransition(async () => {
          try {
            await addPerson(name);
            setName("");
            onAdded();
          } catch {
            setFailed(true);
          }
        });
      }}
    >
      <label htmlFor="new-person">Add a person</label>
      <input
        id="new-person"
        value={name}
        placeholder="Name"
        onChange={(event) => setName(event.target.value)}
        disabled={pending}
      />
      <button type="submit" disabled={pending || !name.trim()}>
        {pending ? "Adding…" : "Add"}
      </button>
      {failed ? <span className="error">Could not add that person.</span> : null}
    </form>
  );
}
