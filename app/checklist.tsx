"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setAscent } from "./actions";
import { AddPerson } from "./add-person";
import { Banner } from "./banner";
import { ChecklistTable } from "./checklist-table";
import { MapView } from "./map/map-view";

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

// Both of this component's toggles store the *absence* of something -- excluded
// people, folded prefectures -- so both need the same copy-then-flip. A fresh
// Set because React compares by reference, and an in-place mutation would not
// re-render.
const toggled = <T,>(current: ReadonlySet<T>, value: T) => {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

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
  const [view, setView] = useState<"table" | "map">("map");
  // Storing *exclusions* rather than the selection itself means "everyone is
  // shown by default" holds for a person who did not exist yet the last time
  // this component rendered — there is nothing to initialise them into. This
  // state is never reconciled against `people`; `selectedIds` below is
  // recomputed from the current roster on every render instead, so a person
  // who is deleted just drops out of the filter, and a deliberate uncheck
  // survives an unrelated router.refresh() because the refresh only ever
  // replaces `people`, never this set.
  const [excludedIds, setExcludedIds] = useState<Set<number>>(() => new Set());
  const selectedIds = useMemo(
    () => people.filter((p) => !excludedIds.has(p.id)).map((p) => p.id),
    [people, excludedIds],
  );

  // Which prefectures are folded shut. Collapsed rather than expanded, for the
  // same reason excludedIds above stores exclusions: an empty set already means
  // "everything open", which is the default, and a prefecture added to the
  // database later shows up open without having to be initialised into
  // anything. An expanded set would need seeding with all 28 keys and would
  // silently fold whatever arrived after it.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Only the fold-all button needs this, and it is derived rather than stored so
  // it cannot fall out of step with the roster. It duplicates one fact that
  // ChecklistTable's `groups` also knows -- that a group is one distinct
  // `prefecture` string -- and the two have to keep agreeing, because `collapsed`
  // keys on exactly that.
  const allPrefectures = useMemo(
    () => new Set(mountains.map((m) => m.prefecture)),
    [mountains],
  );

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

        <div className="table-controls">
          <div className="view-tabs" role="tablist" aria-label="Checklist view">
            <button
              type="button"
              role="tab"
              id="tab-table"
              aria-controls="view-panel"
              aria-selected={view === "table"}
              className={view === "table" ? "on" : undefined}
              onClick={() => setView("table")}
            >
              <span lang="ja">一覧</span> <span className="view-tab-en">Table</span>
            </button>
            <button
              type="button"
              role="tab"
              id="tab-map"
              aria-controls="view-panel"
              aria-selected={view === "map"}
              className={view === "map" ? "on" : undefined}
              onClick={() => setView("map")}
            >
              <span lang="ja">地図</span> <span className="view-tab-en">Map</span>
            </button>
          </div>

          {/* Deliberately a sibling of the tablist, not a child: a tablist
              should contain only tabs, and a plain button inside one reads to
              assistive technology as a third, broken tab. Table view only,
              because folding means nothing on the map. */}
          {view === "table" && mountains.length > 0 ? (
            <button
              type="button"
              className="fold-all"
              onClick={() =>
                setCollapsed((current) => (current.size === 0 ? new Set(allPrefectures) : new Set()))
              }
            >
              <span lang="ja">{collapsed.size === 0 ? "全閉" : "全開"}</span>{" "}
              <span className="view-tab-en">{collapsed.size === 0 ? "Fold all" : "Show all"}</span>
            </button>
          ) : null}
        </div>

        <div id="view-panel" role="tabpanel" aria-labelledby={view === "table" ? "tab-table" : "tab-map"}>
          {view === "table" ? (
            // The scroller only engages under 720px — see .table-scroll. An
            // overflow container is also a containing block for sticky, so
            // switching it on at desktop widths would cost the sticky header
            // for a table that already fits.
            <div className="table-scroll">
              <ChecklistTable
                mountains={mountains}
                people={people}
                entries={entries}
                onSave={save}
                collapsed={collapsed}
                onToggleGroup={(prefecture) => setCollapsed((c) => toggled(c, prefecture))}
              />
            </div>
          ) : (
            <MapView
              mountains={mountains}
              people={people}
              entries={entries}
              selectedIds={selectedIds}
              onTogglePerson={(personId) => setExcludedIds((c) => toggled(c, personId))}
              onSave={save}
            />
          )}
        </div>

        <AddPerson onAdded={() => router.refresh()} />
      </div>
    </main>
  );
}
