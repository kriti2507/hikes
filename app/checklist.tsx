"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setAscent, setPersonPublic } from "./actions";
import { AddPerson } from "./add-person";
import { AdminProvider } from "./auth";
import { Banner } from "./banner";
import { ChecklistTable } from "./checklist-table";
import { ConfirmClear } from "./confirm-clear";
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

// isPublic is the switch in the table header: false hides this person from
// anyone who is not logged in. It is honoured in app/page.tsx's queries, so a
// visitor never receives a private person at all -- which means every Person
// that reaches a visitor's browser has it true, and only the admin ever sees
// one that does not.
export type Person = { id: number; name: string; isPublic: boolean };

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
  isAdmin,
}: {
  mountains: Mountain[];
  people: Person[];
  ascents: Ascent[];
  isAdmin: boolean;
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
  //
  // One consequence worth naming now the fold-all button reads collapsed.size:
  // a prefecture deleted from the database while folded leaves its key behind,
  // so the button would offer "Show all" with nothing visibly folded. Only
  // reachable by editing the database directly -- app/actions.ts only ever
  // touches people and ascents -- so it is left as a known edge rather than
  // reconciled on every render.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Overrides, not a copy of the roster -- the same reason excludedIds stores
  // exclusions: a person this map has never heard of falls back to the
  // isPublic the server sent, so someone added or renamed by a
  // router.refresh() needs no reconciling, and an id left behind by a delete
  // is inert rather than wrong.
  const [publicOverrides, setPublicOverrides] = useState<Map<number, boolean>>(() => new Map());
  const roster = useMemo(
    () => people.map((p) => ({ ...p, isPublic: publicOverrides.get(p.id) ?? p.isPublic })),
    [people, publicOverrides],
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
  function commit(personId: number, mountainId: number, next: Entry) {
    const k = key(personId, mountainId);
    const previous = entries[k] ?? { climbed: false, dateClimbed: null };
    setEntries((current) => ({ ...current, [k]: next }));
    setError(null);

    setAscent(personId, mountainId, next.climbed, next.dateClimbed).catch(() => {
      setEntries((current) => ({ ...current, [k]: previous }));
      setError("Could not save that change. Check your connection and try again.");
    });
  }

  // Every seal on the page -- the table's and the map card's -- comes through
  // here, which is why the confirmation lives at this level rather than in
  // either of them. Ticking, and editing a date, go straight through; clearing
  // a seal that is currently set stops to ask first.
  //
  // Nothing is written to `entries` on the way past, so the seal stays ticked
  // while the dialog is open: the checkbox is controlled, and this state change
  // re-renders it back to the value the database still holds.
  function save(personId: number, mountainId: number, next: Entry) {
    const climbed = entries[key(personId, mountainId)]?.climbed ?? false;
    if (climbed && !next.climbed) {
      setPendingClear({ personId, mountainId, next });
      return;
    }
    commit(personId, mountainId, next);
  }

  // The pending change is kept whole rather than rebuilt on confirm, so what
  // gets written is what the seal asked for and the two cannot drift.
  const [pendingClear, setPendingClear] = useState<{
    personId: number;
    mountainId: number;
    next: Entry;
  } | null>(null);

  // Null unless there is something to ask about, and null again if the roster
  // or the mountain list changed underneath it -- a router.refresh() that
  // deletes the person mid-dialog leaves nothing to name, so there is nothing
  // to confirm either.
  const clearRequest = useMemo(() => {
    if (!pendingClear) return null;
    const person = people.find((p) => p.id === pendingClear.personId);
    const mountain = mountains.find((m) => m.id === pendingClear.mountainId);
    if (!person || !mountain) return null;
    return {
      personName: person.name,
      mountainKanji: mountain.nameKanji,
      mountainEn: mountain.nameEn,
      dateClimbed: entries[key(person.id, mountain.id)]?.dateClimbed ?? null,
    };
  }, [pendingClear, people, mountains, entries]);

  // Same optimistic shape as save(), and it has to be: a checkbox that waits
  // for a round trip before it moves reads as a broken checkbox.
  //
  // Rollback restores this person's previous *override* -- which may be no
  // override at all -- rather than deleting the key. The action deliberately
  // does not revalidate, so `people` still carries whatever isPublic the page
  // was rendered with; falling back to that after a second toggle failed would
  // undo a first one that succeeded. Only this person's key is touched, so a
  // failure here cannot disturb a toggle of someone else in flight.
  function savePublic(personId: number, next: boolean) {
    const previous = publicOverrides.get(personId);
    setPublicOverrides((current) => new Map(current).set(personId, next));
    setError(null);

    setPersonPublic(personId, next).catch(() => {
      setPublicOverrides((current) => {
        const rolled = new Map(current);
        if (previous === undefined) rolled.delete(personId);
        else rolled.set(personId, previous);
        return rolled;
      });
      setError("Could not change who that person is shown to. Check your connection and try again.");
    });
  }

  return (
    <main>
      <AdminProvider isAdmin={isAdmin}>
        <Banner
          people={roster}
          counts={counts}
          total={mountains.length}
          onChanged={() => router.refresh()}
        />

        <div className="sheet">
          {error ? <p className="error banner-error">{error}</p> : null}

          {/* An empty roster means two different things. The admin is looking at
              a database with nobody in it and has the form below to fix that. A
              visitor may be -- or may be looking at a roster where everyone is
              private, which is not theirs to know either way, so the sentence
              says nothing about whether anyone exists. */}
          {roster.length === 0 ? (
            <p className="empty">
              {isAdmin
                ? "No people yet — add someone below to start a column."
                : "Nothing is being shown publicly yet."}
            </p>
          ) : null}

          {/* Wraps the tab strip and the view it labels so that under 720px the
              two can be sized as one viewport-tall column -- the tabs keep
              their natural height and the table pane takes the remainder, which
              is what gives its sticky header something to stick against. See
              .table-pane. Table view only: the class is what carries the height
              cap, and the map is aspect-ratio sized and would spill out of it.
              The element itself is unconditional so switching views does not
              remount the panel. */}
          <div className={view === "table" ? "table-pane" : undefined}>
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
                  should contain only tabs, and a plain button inside one reads
                  to assistive technology as a third, broken tab. Table view
                  only, because folding means nothing on the map. */}
              {view === "table" && mountains.length > 0 ? (
                <button
                  type="button"
                  className="fold-all"
                  onClick={(event) => {
                    // Same reason as the per-group toggles: fold-all can unmount
                    // whatever had focus, and this button survives to hold it.
                    event.currentTarget.focus();
                    setCollapsed((current) =>
                      // Built here rather than memoised above: it is read only on
                      // a press, so there is nothing to cache between them. It
                      // does duplicate one fact ChecklistTable's `groups` also
                      // knows -- that a group is one distinct `prefecture`
                      // string -- and the two have to keep agreeing, because
                      // `collapsed` keys on it.
                      current.size === 0 ? new Set(mountains.map((m) => m.prefecture)) : new Set(),
                    );
                  }}
                >
                  <span lang="ja">{collapsed.size === 0 ? "全閉" : "全開"}</span>{" "}
                  <span className="view-tab-en">{collapsed.size === 0 ? "Fold all" : "Show all"}</span>
                </button>
              ) : null}
            </div>

            {/* The id is what aria-controls on the tabs points at; the class is
                for .table-pane to size against, so the stylesheet stays free of
                id selectors. */}
            <div
              id="view-panel"
              className="view-panel"
              role="tabpanel"
              aria-labelledby={view === "table" ? "tab-table" : "tab-map"}
            >
              {view === "table" ? (
                // The scroller only engages under 720px — see .table-scroll. An
                // overflow container is also a containing block for sticky, so
                // switching it on at desktop widths would cost the sticky header
                // for a table that already fits.
                <div className="table-scroll">
                  <ChecklistTable
                    mountains={mountains}
                    people={roster}
                    entries={entries}
                    onSave={save}
                    onSavePublic={savePublic}
                    collapsed={collapsed}
                    onToggleGroup={(prefecture) => setCollapsed((c) => toggled(c, prefecture))}
                  />
                </div>
              ) : (
                <MapView
                  mountains={mountains}
                  people={roster}
                  entries={entries}
                  selectedIds={selectedIds}
                  onTogglePerson={(personId) => setExcludedIds((c) => toggled(c, personId))}
                  onSave={save}
                />
              )}
            </div>
          </div>

          <AddPerson onAdded={() => router.refresh()} />
        </div>

        {/* One for the page, like the locked-control tooltip above it: there is
            only ever one seal being cleared at a time. In the top layer, so it
            is not clipped by the table's horizontal scroller on a phone. */}
        <ConfirmClear
          request={clearRequest}
          onConfirm={() => {
            if (pendingClear) {
              commit(pendingClear.personId, pendingClear.mountainId, pendingClear.next);
            }
            setPendingClear(null);
          }}
          onCancel={() => setPendingClear(null)}
        />
      </AdminProvider>
    </main>
  );
}
