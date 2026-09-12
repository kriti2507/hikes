"use client";

import { type CSSProperties, useState } from "react";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakMarker } from "./peak-marker";
import { PersonFilter } from "./person-filter";
import { useMapMarkers } from "./use-map-markers";
import { usePanZoom } from "./use-pan-zoom";

export function MapView({
  mountains,
  people,
  entries,
  selectedIds,
  onTogglePerson,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  selectedIds: number[];
  onTogglePerson: (personId: number) => void;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
}) {
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const { viewBox, unitsPerPixel, measured, handlers } = usePanZoom(element);

  const { clusters, fillFor, missing } = useMapMarkers({ mountains, entries, selectedIds, unitsPerPixel });

  // Clustering only groups placed peaks, it never drops or duplicates one, so
  // summing member counts recovers the same total the pre-extraction `placed`
  // array gave without map-view.tsx needing to hold that array itself.
  const total = clusters.reduce((sum, c) => sum + c.members.length, 0);
  const fullyClimbed =
    selectedIds.length === 0
      ? 0
      : clusters.reduce((sum, c) => sum + c.members.filter((m) => fillFor(m.mountain) === 1).length, 0);

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  return (
    <div className="map">
      <PersonFilter
        people={people}
        selectedIds={selectedIds}
        onToggle={onTogglePerson}
        fullyClimbed={fullyClimbed}
        total={total}
      />
      <svg
        ref={setElement}
        className="map-surface"
        viewBox={viewBox}
        // The CSS needs the projection's dimensions for its aspect ratio and
        // width cap; passing them in keeps projection.mjs the only place they
        // are written down. Same pattern as --tilt in checklist-table.tsx.
        style={{ "--map-w": WIDTH, "--map-h": HEIGHT } as CSSProperties}
        {...handlers}
        aria-label="Map of Japan showing the hundred famous mountains"
      >
        <g className="map-prefectures">
          {prefectures.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g className="map-coastline">
          {coastline.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* Markers wait for the first ResizeObserver measurement. Until then
            unitsPerPixel is a placeholder, and clustering keyed off a wrong
            value would paint the wrong groupings and then reflow. */}
        <g className="map-markers">
          {measured && clusters.map((c) => {
            // Markers are drawn in pixel units; the counter-scale keeps them
            // the same size on screen however far the map is zoomed.
            const transform = `translate(${c.x} ${c.y}) scale(${unitsPerPixel})`;

            if (c.members.length === 1) {
              const peak = c.members[0];
              const fill = fillFor(peak.mountain);
              return (
                <g key={`m${peak.mountain.id}`} transform={transform}>
                  <PeakMarker
                    fill={fill}
                    selected={false}
                    label={`${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`}
                    onActivate={() => {}}
                  />
                </g>
              );
            }

            const done = c.members.filter((m) => fillFor(m.mountain) === 1).length;
            return (
              <g key={`c${c.members[0].mountain.id}`} transform={transform}>
                <ClusterMarker
                  count={c.members.length}
                  fill={done / c.members.length}
                  label={`${c.members.length} peaks, ${done} climbed by everyone selected. Zoom in.`}
                  onActivate={() => {}}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <p className="map-note">
        Summit positions are approximate — good to about a kilometre.
        {source === "placeholder" ? " The coastline is a schematic placeholder." : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}
      </p>
    </div>
  );
}
