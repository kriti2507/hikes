"use client";

import { useEffect, useRef } from "react";
import { type Entry, type Mountain, type Person, key } from "../checklist";

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
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Capture phase: the map swallows pointer events for panning, so a
    // bubbling listener would never see a click that landed on the map.
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const notes = [mountain.region, mountain.notes, mountain.alsoIn && `also ${mountain.alsoIn}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="peak-card" ref={card} style={style} role="group" aria-label={mountain.nameEn}>
      <button type="button" className="peak-card-close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <span className="kanji">{mountain.nameKanji}</span>
      <span className="kana">{mountain.nameKana}</span>
      <span className="en">{mountain.nameEn}</span>

      <p className="peak-card-meta">
        {mountain.elevationM.toLocaleString("en-US")} m · {mountain.prefectureJa}
        {mountain.bestSeason ? ` · ${mountain.bestSeason}` : null}
      </p>
      {notes ? <p className="peak-card-notes">{notes}</p> : null}

      <ul className="peak-card-people">
        {people.map((person) => {
          const entry = entries[key(person.id, mountain.id)];
          const climbed = entry?.climbed ?? false;
          return (
            <li key={person.id}>
              <label>
                <input
                  type="checkbox"
                  checked={climbed}
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
                  onChange={(event) =>
                    onSave(person.id, mountain.id, {
                      climbed: true,
                      dateClimbed: event.target.value || null,
                    })
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
