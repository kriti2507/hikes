"use client";

import type { Person } from "../checklist";

/**
 * Restates the fill rule in words so the map is never ambiguous about what is
 * being shown. Phrasing follows the size of the selection.
 */
function summary(selected: Person[], fullyClimbed: number, total: number) {
  if (selected.length === 0) return "Nobody selected — tick someone to ink the map";
  if (selected.length === 1) return `${fullyClimbed} of ${total} climbed by ${selected[0].name}`;
  if (selected.length === 2) return `${fullyClimbed} of ${total} climbed by both`;
  return `${fullyClimbed} of ${total} climbed by all ${selected.length}`;
}

export function PersonFilter({
  people,
  selectedIds,
  onToggle,
  fullyClimbed,
  total,
}: {
  people: Person[];
  selectedIds: number[];
  onToggle: (personId: number) => void;
  fullyClimbed: number;
  total: number;
}) {
  const selected = people.filter((p) => selectedIds.includes(p.id));

  return (
    <div className="map-filter">
      <span className="map-filter-label">Showing</span>
      {people.map((person) => {
        const on = selectedIds.includes(person.id);
        return (
          <button
            key={person.id}
            type="button"
            className={`chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onToggle(person.id)}
          >
            {person.name}
          </button>
        );
      })}
      <span className="map-filter-summary">{summary(selected, fullyClimbed, total)}</span>
    </div>
  );
}
