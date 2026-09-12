"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakCard } from "./peak-card";
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
  onSave,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  selectedIds: number[];
  onTogglePerson: (personId: number) => void;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
}) {
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const { viewBox, unitsPerPixel, measured, wasDragged, handlers } = usePanZoom(element);
  const [openId, setOpenId] = useState<number | null>(null);

  const { clusters, fillFor, missing, total, fullyClimbed } = useMapMarkers({
    mountains,
    entries,
    selectedIds,
    unitsPerPixel,
  });

  // Close the card whenever the clustering changes, so a peak that has just
  // been swallowed by a ridge does not leave a card pointing at nothing.
  useEffect(() => {
    if (openId === null) return;
    const stillAlone = clusters.some(
      (c) => c.members.length === 1 && c.members[0].mountain.id === openId,
    );
    if (!stillAlone) setOpenId(null);
  }, [clusters, openId]);

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  const [vbX, vbY, vbW] = viewBox.split(" ").map(Number);
  const open = clusters
    .flatMap((c) => c.members)
    .find((p) => p.mountain.id === openId);

  // A peak more than about three-fifths of the way across would push a
  // right-hand card off the edge, so it flips to the left instead.
  const cardStyle: React.CSSProperties | null = open
    ? (() => {
        const leftPercent = ((open.x - vbX) / vbW) * 100;
        const topPercent = ((open.y - vbY) / (vbW * (HEIGHT / WIDTH))) * 100;
        return leftPercent > 62
          ? { right: `${100 - leftPercent}%`, top: `${topPercent}%`, marginRight: "14px" }
          : { left: `${leftPercent}%`, top: `${topPercent}%`, marginLeft: "14px" };
      })()
    : null;

  return (
    <div className="map">
      <PersonFilter
        people={people}
        selectedIds={selectedIds}
        onToggle={onTogglePerson}
        fullyClimbed={fullyClimbed}
        total={total}
      />
      <div className="map-frame">
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
          <g
            className="map-markers"
            onClickCapture={(event) => {
              // A pan that ends over a peak still synthesises a click on it.
              // Capture phase runs before the marker's own handler, so
              // stopping here suppresses it. Deliberately only on the click
              // path: every real click is preceded by a pointerdown that
              // resets the flag, whereas keyboard activation never touches
              // it and must not be suppressed by a stale drag.
              if (wasDragged()) event.stopPropagation();
            }}
          >
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
                      selected={openId === peak.mountain.id}
                      label={`${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`}
                      onActivate={() => setOpenId(peak.mountain.id)}
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

        {open && cardStyle ? (
          <PeakCard
            mountain={open.mountain}
            people={people}
            entries={entries}
            onSave={onSave}
            onClose={() => setOpenId(null)}
            style={cardStyle}
          />
        ) : null}
      </div>

      <p className="map-note">
        Summit positions are approximate — good to about a kilometre.
        {source === "placeholder" ? " The coastline is a schematic placeholder." : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}
      </p>
    </div>
  );
}
