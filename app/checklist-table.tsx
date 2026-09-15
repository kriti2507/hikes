"use client";

import { Fragment, type CSSProperties, useMemo } from "react";
import type { Entry, Mountain, Person } from "./checklist";
import { key } from "./checklist";

// Degrees of tilt a seal can land at, picked by mountain id.
const TILTS = [-3, -1.5, 0, 1.5, 3];

export function ChecklistTable({
  mountains,
  people,
  entries,
  onSave,
  collapsed,
  onToggleGroup,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
  collapsed: Set<string>;
  onToggleGroup: (prefecture: string) => void;
}) {
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

  return (
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
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.prefecture);

          return (
          <Fragment key={group.prefecture}>
            <tr className="group">
              <th colSpan={5 + people.length}>
                {/* A real button, so focus, Enter, Space and the disclosure
                    role all come for free. aria-expanded carries the state and
                    the arrow is aria-hidden, because it says the same thing
                    again in a way a screen reader should not repeat. */}
                <button
                  type="button"
                  className="group-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => onToggleGroup(group.prefecture)}
                >
                  <span className="group-arrow" aria-hidden="true">▸</span>
                  <span lang="ja">{group.prefectureJa}</span>
                  <span className="prefecture-en">
                    {group.prefecture} · {group.mountains.length}
                  </span>
                </button>
              </th>
            </tr>
            {/* Unmounted rather than hidden: a display:none row still costs
                layout and still sits in the accessibility tree. */}
            {isCollapsed ? null : group.mountains.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.fukadaNumber ?? "—"}</td>
                <td className="mountain">
                  <span className="kanji" lang="ja">{m.nameKanji}</span>
                  <span className="kana" lang="ja">{m.nameKana}</span>
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
                          onSave(person.id, m.id, {
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
                            onSave(person.id, m.id, { climbed: true, dateClimbed: event.target.value || null })
                          }
                        />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
