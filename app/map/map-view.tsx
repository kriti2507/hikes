"use client";

import { type CSSProperties, useMemo, useState } from "react";
import { cluster } from "@/lib/map/cluster.mjs";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH, project } from "@/lib/map/projection.mjs";
import { type Entry, type Mountain, type Person, key } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakMarker } from "./peak-marker";
import { usePanZoom } from "./use-pan-zoom";

// Screen pixels below which two peaks merge into a ridge. A triangle is 14px
// wide, so this leaves a clear gap between neighbours.
const MIN_SEPARATION_PX = 22;

type PlacedPeak = {
  order: number;
  x: number;
  y: number;
  mountain: Mountain;
};

export function MapView({
  mountains,
  people,
  entries,
  selectedIds,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  selectedIds: number[];
}) {
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const { viewBox, unitsPerPixel, measured, handlers } = usePanZoom(element);

  const placed = useMemo<PlacedPeak[]>(
    () =>
      mountains
        .filter((m) => m.latitude !== null && m.longitude !== null)
        .map((m) => ({
          // Fukada order, with unnumbered additions after all hundred, so the
          // clustering tie-break is stable and matches the table.
          order: m.fukadaNumber ?? 10_000 + m.id,
          ...project(m.latitude as number, m.longitude as number),
          mountain: m,
        })),
    [mountains],
  );

  const missing = mountains.length - placed.length;

  /** 0 to 1: how many of the selected people have climbed this peak. */
  const fillFor = (mountain: Mountain) => {
    if (selectedIds.length === 0) return 0;
    const climbed = selectedIds.filter((id) => entries[key(id, mountain.id)]?.climbed).length;
    return climbed / selectedIds.length;
  };

  // Memoised on unitsPerPixel alone: panning does not change which peaks
  // collide, so it must not pay for a reclustering.
  const clusters = useMemo(
    () => cluster(placed, MIN_SEPARATION_PX * unitsPerPixel),
    [placed, unitsPerPixel],
  );

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  return (
    <div className="map">
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
