"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakCard } from "./peak-card";
import { PeakMarker } from "./peak-marker";
import { PersonFilter } from "./person-filter";
import { NAME_ROOM_PX, useMapMarkers } from "./use-map-markers";
import { NAME_SCALE, usePanZoom } from "./use-pan-zoom";

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
  const { scale, viewBox, unitsPerPixel, measured, wasDragged, zoomBy, fit, fitBounds, handlers } =
    usePanZoom(element);
  const [openId, setOpenId] = useState<number | null>(null);

  const { clusters, fillFor, missing, total, fullyClimbed } = useMapMarkers({
    mountains,
    entries,
    selectedIds,
    unitsPerPixel,
  });

  // Housekeeping only: `open` below already stops resolving to a peak the
  // instant it is swallowed into a ridge, so the card never paints over the
  // wrong marker. This just clears the now-stale id so state does not linger.
  useEffect(() => {
    if (openId === null) return;
    const stillAlone = clusters.some(
      (c) => c.members.length === 1 && c.members[0].mountain.id === openId,
    );
    if (stillAlone) return;

    // This close was not asked for -- a ridge swallowed the open peak on
    // zoom-out, not Escape, the close button, or an outside click -- so the
    // card is about to unmount without ever running its own restore logic.
    // Losing focus to <body> would be worse than not restoring it to the old
    // target: rescue it onto the map surface instead, so the user keeps
    // their place on the map they were just looking at.
    if (document.activeElement?.closest(".peak-card")) element?.focus();
    setOpenId(null);
  }, [clusters, openId, element]);

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  const [vbX, vbY, vbW] = viewBox.split(" ").map(Number);
  // Only a lone peak has a card. Deriving `open` this way rather than
  // searching every cluster's members means a peak swallowed into a ridge
  // loses its card in the same render as the merge — no frame where the card
  // floats over a marker that is no longer its peak.
  const open =
    clusters.find((c) => c.members.length === 1 && c.members[0].mountain.id === openId)
      ?.members[0] ?? null;

  // Past roughly three-fifths across or down, a card anchored on the near
  // side would hang off the frame, so it flips to the far side instead.
  const cardStyle: React.CSSProperties | null = open
    ? (() => {
        const leftPercent = ((open.x - vbX) / vbW) * 100;
        const topPercent = ((open.y - vbY) / (vbW * (HEIGHT / WIDTH))) * 100;
        const horizontal =
          leftPercent > 62
            ? { right: `${100 - leftPercent}%`, marginRight: "14px" }
            : { left: `${leftPercent}%`, marginLeft: "14px" };
        // The triangle only extends upward from its anchor, so an unflipped
        // card (growing downward from `top`) naturally clears it and needs no
        // gap. A flipped card grows upward from `bottom` into that same
        // space, so it needs the same 14px clearance the horizontal branch
        // already gives both of its directions.
        const vertical =
          topPercent > 62
            ? { bottom: `${100 - topPercent}%`, marginBottom: "14px" }
            : { top: `${topPercent}%` };
        return { ...horizontal, ...vertical };
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
          // -1 rather than absent: this lets the housekeeping effect above
          // rescue focus here when a ridge swallows the open card, without
          // adding the whole surface as a stop in the normal tab order.
          tabIndex={-1}
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
                // NAME_SCALE alone is not enough: a name reaches far past the
                // 22px clustering guarantee (NAME_ROOM_PX), so it also needs
                // this peak's own measured clearance to its nearest neighbour.
                const hasRoom = scale >= NAME_SCALE && c.nearestNeighborPx > NAME_ROOM_PX;
                return (
                  <g key={`m${peak.mountain.id}`} transform={transform}>
                    <PeakMarker
                      fill={fill}
                      selected={openId === peak.mountain.id}
                      number={peak.mountain.fukadaNumber}
                      name={hasRoom ? peak.mountain.nameEn : null}
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
                    onActivate={() =>
                      fitBounds(
                        Math.min(...c.members.map((m) => m.x)),
                        Math.min(...c.members.map((m) => m.y)),
                        Math.max(...c.members.map((m) => m.x)),
                        Math.max(...c.members.map((m) => m.y)),
                      )
                    }
                  />
                </g>
              );
            })}
          </g>
        </svg>

        <div className="map-zoom">
          <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="fit" onClick={fit} aria-label="Show the whole country">
            全図
          </button>
        </div>

        {open && cardStyle ? (
          <PeakCard
            // A different peak is a different card: without this, switching
            // straight from one open card to another lone peak reconciles
            // the same component instance, so the mount-only effect that
            // moves focus in and captures the restore target never re-runs.
            key={open.mountain.id}
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
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}{" "}
        The <span lang="ja">一覧</span> table lists every peak in full.
      </p>
    </div>
  );
}
