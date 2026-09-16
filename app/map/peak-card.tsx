"use client";

import { useCallback, useEffect, useRef } from "react";
import { type Entry, type Mountain, type Person, key } from "../checklist";
import { Locked, useAdmin } from "../auth";

export function PeakCard({
  mountain,
  people,
  entries,
  onSave,
  onClose,
  style,
}: {
  mountain: Mountain;
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
  onClose: () => void;
  style: React.CSSProperties;
}) {
  const { isAdmin } = useAdmin();
  const card = useRef<HTMLDivElement>(null);

  // Where to send focus back to on a deliberate close. A ref to the marker
  // <g> that opened the card would be fragile -- clustering re-renders can
  // swap it for a new DOM node as the map is panned or zoomed -- so instead
  // this captures whatever had focus at the instant the card took over,
  // which is that same marker in the common case, and checks it is still
  // attached before using it rather than trusting it blindly.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The card itself, not one of its controls: there is no single obvious
    // first field here (a close button and a list of tick boxes are equally
    // arbitrary candidates), so the honest thing to focus is the dialog's own
    // name, which `card.current.focus()` announces via its aria-label.
    card.current?.focus();
  }, []);

  // Escape, the close button and an outside click are the three deliberate
  // ways to close this card, and all three restore focus. A ridge swallowing
  // the open peak on zoom-out closes it a fourth way -- the parent clears its
  // open id directly -- and deliberately never calls this: the user did not
  // ask for that close, and focus may by then be somewhere else entirely, so
  // stealing it back would be wrong.
  const closeAndRestore = useCallback(() => {
    const target = previouslyFocused.current;
    if (target && document.contains(target)) target.focus();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAndRestore();
    };
    const onDown = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) closeAndRestore();
    };
    document.addEventListener("keydown", onKey);
    // Capture phase: the map swallows pointer events for panning, so a
    // bubbling listener would never see a click that landed on the map.
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [closeAndRestore]);

  const notes = [mountain.region, mountain.notes, mountain.alsoIn && `also ${mountain.alsoIn}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="peak-card"
      ref={card}
      style={style}
      role="dialog"
      tabIndex={-1}
      aria-label={mountain.nameEn}
    >
      <button type="button" className="peak-card-close" onClick={closeAndRestore} aria-label="Close">
        ×
      </button>

      <span className="kanji" lang="ja">{mountain.nameKanji}</span>
      <span className="kana" lang="ja">{mountain.nameKana}</span>
      <span className="en">{mountain.nameEn}</span>

      <p className="peak-card-meta">
        {mountain.elevationM.toLocaleString("en-US")} m · <span lang="ja">{mountain.prefectureJa}</span>
        {mountain.bestSeason ? ` · ${mountain.bestSeason}` : null}
      </p>
      {notes ? <p className="peak-card-notes">{notes}</p> : null}

      <ul className="peak-card-people">
        {people.map((person) => {
          const entry = entries[key(person.id, mountain.id)];
          const climbed = entry?.climbed ?? false;
          return (
            <li key={person.id}>
              {/* `readable`: this row names a person and says whether
                  they climbed the peak, which is the card's whole content.
                  See app/auth.tsx. */}
              <Locked className="locked-row" readable>
                <label>
                  <input
                    type="checkbox"
                    checked={climbed}
                    aria-label={`${person.name} climbed ${mountain.nameEn}`}
                    aria-disabled={isAdmin ? undefined : true}
                    tabIndex={isAdmin ? undefined : -1}
                    onChange={(event) =>
                      onSave(person.id, mountain.id, {
                        climbed: event.target.checked,
                        // Unchecking discards the date, as in the table: the row
                        // means "not climbed", so a date would contradict it.
                        dateClimbed: event.target.checked ? (entry?.dateClimbed ?? null) : null,
                      })
                    }
                  />
                  {person.name}
                </label>
                {climbed ? (
                  <input
                    type="date"
                    className="date"
                    value={entry?.dateClimbed ?? ""}
                    aria-label={`Date ${person.name} climbed ${mountain.nameEn}`}
                    aria-disabled={isAdmin ? undefined : true}
                    tabIndex={isAdmin ? undefined : -1}
                    onChange={(event) =>
                      onSave(person.id, mountain.id, {
                        climbed: true,
                        dateClimbed: event.target.value || null,
                      })
                    }
                  />
                ) : null}
              </Locked>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
