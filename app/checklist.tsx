"use client";

import { type CSSProperties, Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPerson, deletePerson, setAscent, updatePerson } from "./actions";

// Degrees of tilt a seal can land at, picked by mountain id.
const TILTS = [-3, -1.5, 0, 1.5, 3];

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
      <header className="banner">
        {/* Decorative: the print carries no information the text does not. */}
        <div className="banner-print" aria-hidden="true" />
        <div className="banner-text">
          <h1>
            日本百名山
            <span>
              The Hundred Famous Mountains
              <br />
              Fukada Kyūya, 1964
            </span>
          </h1>
          <ul className="tally">
            {people.map((person) => (
              <li key={person.id}>
                {/* The seal is a fixed square, so edit/delete sit below it rather
                    than inside — the stamp keeps its proportions either way. */}
                <div
                  className="tally-seal"
                  title={`${person.name}: ${counts.get(person.id) ?? 0} of ${mountains.length}`}
                >
                  <strong>{counts.get(person.id) ?? 0}</strong>
                  <span>{person.name}</span>
                </div>
                <PersonActions person={person} onChanged={() => router.refresh()} />
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="sheet">
        {error ? <p className="error banner-error">{error}</p> : null}

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
                            // A seal is pressed by hand, so no two sit quite square.
                            // Seeding the tilt from the id keeps it stable across
                            // renders — random would reshuffle on every keystroke.
                            style={{ "--tilt": `${TILTS[m.id % TILTS.length]}deg` } as CSSProperties}
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

function PersonActions({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [name, setName] = useState(person.name);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(nextMode: "edit" | "delete") {
    setMode(nextMode);
    setName(person.name);
    setPassword("");
    setError(null);
  }

  function close() {
    if (pending) return;
    setMode("closed");
    setPassword("");
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        if (mode === "edit") await updatePerson(person.id, name, password);
        else if (mode === "delete") await deletePerson(person.id, password);
        setMode("closed");
        setPassword("");
        onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save that change.");
      }
    });
  }

  if (mode === "closed") {
    return (
      <span className="person-actions">
        <button type="button" className="text-button" onClick={() => open("edit")}>
          Edit
        </button>
        <button type="button" className="text-button danger-text" onClick={() => open("delete")}>
          Delete
        </button>
      </span>
    );
  }

  return (
    <form className="person-action-form" onSubmit={submit}>
      {mode === "edit" ? (
        <>
          <label htmlFor={`edit-person-${person.id}`}>New name</label>
          <input
            id={`edit-person-${person.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            autoFocus
          />
        </>
      ) : (
        <p>Delete {person.name} and all of their ascents?</p>
      )}
      <label htmlFor={`confirm-password-${person.id}`}>Password</label>
      <input
        id={`confirm-password-${person.id}`}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={pending}
        autoComplete="current-password"
        required
      />
      {error ? <span className="error">{error}</span> : null}
      <span className="person-form-buttons">
        <button
          type="submit"
          className={mode === "delete" ? "danger-button" : undefined}
          disabled={pending || (mode === "edit" && !name.trim())}
        >
          {pending ? "Saving…" : mode === "edit" ? "Save" : "Delete"}
        </button>
        <button type="button" className="secondary-button" onClick={close} disabled={pending}>
          Cancel
        </button>
      </span>
    </form>
  );
}
