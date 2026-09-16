"use client";

import { Fragment, type CSSProperties, useMemo } from "react";
import type { Entry, Mountain, Person } from "./checklist";
import { key } from "./checklist";
import { countFullyClimbed } from "@/lib/progress.mjs";
import { Locked, useAdmin } from "./auth";

// Degrees of tilt a seal can land at, picked by mountain id.
const TILTS = [-3, -1.5, 0, 1.5, 3];

export function ChecklistTable({
  mountains,
  people,
  entries,
  onSave,
  onSavePublic,
  collapsed,
  onToggleGroup,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
  onSavePublic: (personId: number, next: boolean) => void;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (prefecture: string) => void;
}) {
  const { isAdmin } = useAdmin();

  // Keyed by prefecture rather than merging only adjacent rows. prefecture_sort
  // is a per-row column defaulting to 999, so an unnumbered addition can land
  // apart from the rest of its prefecture -- and `collapsed` keys on the name,
  // so two groups sharing it would fold and unfold as one. A Map keeps the
  // order of each prefecture's first appearance, which is the order the query
  // chose -- and for a prefecture split across the ordering, its earliest row
  // is where the whole group surfaces.
  const groups = useMemo(() => {
    const byPrefecture = new Map<
      string,
      { prefecture: string; prefectureJa: string; mountains: Mountain[] }
    >();
    for (const m of mountains) {
      const existing = byPrefecture.get(m.prefecture);
      if (existing) existing.mountains.push(m);
      else
        byPrefecture.set(m.prefecture, {
          prefecture: m.prefecture,
          prefectureJa: m.prefectureJa,
          mountains: [m],
        });
    }
    return [...byPrefecture.values()];
  }, [mountains]);

  // Hoisted out of the loop below: both are the same for every heading, and
  // rebuilding the id list inside it means one identical allocation per group.
  const personIds = people.map((p) => p.id);
  const isClimbed = (personId: number, mountainId: number) =>
    entries[key(personId, mountainId)]?.climbed ?? false;

  return (
    // --public-row tells tr.group th how far down to pin: the header grows by a
    // line when the Public row is in it, and the prefecture bands sit directly
    // under the header. Declared here rather than measured, for the same reason
    // --thead-h is in the stylesheet -- there is nothing to measure it against
    // until paint. See globals.css.
    <table className={isAdmin ? "has-public-row" : undefined}>
      <thead>
        <tr>
          <th className="num">#</th>
          <th className="mountain">Mountain</th>
          <th className="elev">Height</th>
          <th className="season">Best time</th>
          <th className="notes">
            Notes
            {/* The word the Public boxes need, parked in the one header cell
                with a spare line and no width to lose: the notes column is
                sized by its body text, which is wider than this, so the label
                costs the table nothing. Per-column it cost ~35px of
                min-content, which the table does not have -- at six people it
                already fills the sheet exactly, so the surplus came straight
                off the right edge as a scrollbar.

                aria-hidden because it is not this column's heading and every
                box carries its own label. Right-aligned, so it ends where the
                first box begins; on mobile the notes column collapses to zero
                and takes the word with it, which is what we want there too. */}
            {isAdmin ? (
              <span className="public-caption" aria-hidden="true">
                Public
              </span>
            ) : null}
          </th>
          {people.map((person) => (
            <th key={person.id} className="person">
              {person.name}
              {/* Admin only, and not wrapped in Locked like every other edit
                  affordance on this page. The rest are shown to visitors
                  deliberately, inert, so the page explains that someone can
                  edit it. This one's *state* is the private thing: a dimmed
                  unticked box would tell a visitor that somebody is being kept
                  from them, which is the fact it exists to keep. */}
              {isAdmin ? (
                <label
                  className="public-toggle"
                  title={`Show ${person.name} to visitors who are not logged in`}
                >
                  <input
                    type="checkbox"
                    className="tick"
                    checked={person.isPublic}
                    aria-label={`Show ${person.name} on the public page`}
                    onChange={(event) => onSavePublic(person.id, event.target.checked)}
                  />
                </label>
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.prefecture);
          const n = group.mountains.length;
          // Only a folded heading shows the fraction, so only a folded heading
          // pays for counting it. A peak counts once *everyone on the roster*
          // has it -- the same rule the map applies, except the map applies it
          // to the people currently ticked in its filter, so the two agree only
          // while nothing is filtered out. The table has no filter, so the whole
          // roster is the only roster it has. An empty one makes "everyone has
          // it" vacuously true, so the fraction gives way to the plain count --
          // see lib/progress.mjs.
          const countLabel =
            isCollapsed && personIds.length > 0
              ? `${countFullyClimbed(
                  group.mountains.map((m) => m.id),
                  personIds,
                  isClimbed,
                )}/${n}`
              : `${n}`;

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
                    onClick={(event) => {
                      // Keep focus on the control that was activated. Safari and
                      // Firefox on macOS do not focus a button on click, so
                      // without this a fold that unmounts the focused checkbox
                      // drops focus to <body> and the next Tab restarts at the
                      // top of the document. Programmatic focus after a pointer
                      // event does not match :focus-visible, so mouse users get
                      // no stray ring. The map's fan controls manage focus
                      // deliberately for the same reason.
                      event.currentTarget.focus();
                      onToggleGroup(group.prefecture);
                    }}
                  >
                    <span className="group-arrow" aria-hidden="true" />
                    <span lang="ja">{group.prefectureJa}</span>
                    <span className="prefecture-en">
                      {group.prefecture} <span aria-hidden="true">·</span> {countLabel}
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
                        {/* `readable`: a seal is the data this page exists to
                            show, so a visitor's screen reader must still hear
                            who climbed what. See app/auth.tsx. */}
                        <Locked className="locked-cell" readable>
                          <input
                            type="checkbox"
                            checked={climbed}
                            aria-label={`${person.name} climbed ${m.nameEn}`}
                            aria-disabled={isAdmin ? undefined : true}
                            tabIndex={isAdmin ? undefined : -1}
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
                              aria-disabled={isAdmin ? undefined : true}
                              tabIndex={isAdmin ? undefined : -1}
                              onChange={(event) =>
                                onSave(person.id, m.id, { climbed: true, dateClimbed: event.target.value || null })
                              }
                            />
                          ) : null}
                        </Locked>
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
