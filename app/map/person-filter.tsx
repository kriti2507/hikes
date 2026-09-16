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
      <span className="map-filter-label" id="map-filter-label">
        Showing
      </span>
      {/* A group of its own rather than checkboxes loose among the label and the
          summary: it is what "Showing" names, and it keeps the pigment cycle
          below counting people from one. Not a fieldset, whose legend cannot be
          placed on the same line as the controls it introduces. */}
      <div className="map-filter-people" role="group" aria-labelledby="map-filter-label">
        {people.map((person) => {
          const on = selectedIds.includes(person.id);
          return (
            // Real checkboxes, not chips with aria-pressed. A pressed button
            // states what it is only to a screen reader; on screen it was a
            // coloured pill, and a row of them read as decoration rather than
            // as five things you can turn off. The box is the affordance.
            //
            // The label wraps the input, so it needs no `for`/`id` pair and the
            // whole pill is the hit area -- which is most of the point on a
            // phone, where the name alone is a 13px target.
            <label key={person.id} className="person-check">
              <input type="checkbox" checked={on} onChange={() => onToggle(person.id)} />
              {person.name}
            </label>
          );
        })}
      </div>
      {/* The boxes announce their own checked state; this sentence is what
          actually explains what the map now shows, so it announces itself. */}
      <span className="map-filter-summary" aria-live="polite">
        {summary(selected, fullyClimbed, total)}
      </span>
    </div>
  );
}
