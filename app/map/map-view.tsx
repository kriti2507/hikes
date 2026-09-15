"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { coastline, type GeometrySource, prefectures, source } from "@/lib/map/japan-geometry";
import { fanOffsets } from "@/lib/map/fan.mjs";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakCard } from "./peak-card";
import { PEAK_HEIGHT, PeakMarker } from "./peak-marker";
import { PersonFilter } from "./person-filter";
import { useMapMarkers } from "./use-map-markers";
import { MAX_SCALE, NAME_SCALE, usePanZoom } from "./use-pan-zoom";

// Looked up rather than branched on: `source` is generated with one value, so
// `source === "placeholder"` is a type error the moment real geometry is built.
// A record over the union keeps both captions honest and forces a new source to
// bring its own.
const COASTLINE_NOTE: Record<GeometrySource, string> = {
  placeholder: " The coastline is a schematic placeholder.",
  "natural-earth": " The coastline is Natural Earth 1:10m, thinned for this scale.",
};

// One name for a cluster, used both as its React key and as the identity the
// fan remembers. cluster.mjs sorts members by `order` and keeps them sorted
// through every merge, so members[0] is stable across renders -- that is what
// makes this usable as a key at all.
const keyOf = (c: { members: { mountain: Mountain }[] }) =>
  c.members.length === 1 ? `m${c.members[0].mountain.id}` : `c${c.members[0].mountain.id}`;

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
  // The key of the ridge currently drawn fanned out, or null. A fan only
  // exists at maximum zoom: it is the answer to "zooming cannot separate
  // these", so below the cap zooming is still the better answer.
  const [fannedId, setFannedId] = useState<string | null>(null);

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

  // A zoom-out collapses the fan outright -- it is no longer the cap, so
  // zooming is the better answer again. But scale is not the only thing that
  // can move the ridges: useMapMarkers reclusters on unitsPerPixel, which a
  // window resize changes without touching scale at all, and that can shift
  // which peak is members[0] of the fanned cluster. When that happens
  // keyOf(c) stops matching fannedId, the ridge falls through to the plain
  // ClusterMarker branch, and a stale fannedId is left pointing at nothing.
  useEffect(() => {
    if (fannedId === null) return;
    if (scale < MAX_SCALE) {
      setFannedId(null);
      return;
    }
    if (!clusters.some((c) => c.members.length > 1 && keyOf(c) === fannedId)) setFannedId(null);
  }, [scale, clusters, fannedId]);

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  const [vbX, vbY, vbW] = viewBox.split(" ").map(Number);
  // Only a peak the map draws on its own has a card, and the card anchors to
  // where that peak is *drawn*. Deriving this from the clusters rather than
  // searching every member means a peak swallowed into a ridge loses its card
  // in the same render as the merge — no frame where the card floats over a
  // marker that is no longer its peak.
  const open: { mountain: Mountain; x: number; y: number } | null =
    openId === null
      ? null
      : (clusters.find((c) => c.members.length === 1 && c.members[0].mountain.id === openId)
          ?.members[0] ?? null);

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
                return (
                  <g key={keyOf(c)} transform={transform}>
                    <PeakMarker
                      fill={fill}
                      selected={openId === peak.mountain.id}
                      number={peak.mountain.fukadaNumber}
                      // Every peak the map draws on its own gets its name.
                      // Above NAME_SCALE two names can still overlap where
                      // peaks sit close; the map prefers naming every peak
                      // consistently over hiding some to keep others clean.
                      name={scale >= NAME_SCALE ? peak.mountain.nameEn : null}
                      label={`${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`}
                      onActivate={() => setOpenId(peak.mountain.id)}
                    />
                  </g>
                );
              }

              if (keyOf(c) === fannedId) {
                const offsets = fanOffsets(c.members.length);
                // `fan` carries no styles of its own -- it exists so a
                // later focus-rescue check can ask whether the element
                // holding focus sits inside the fan that is about to vanish.
                return (
                  <g className="fan" key={keyOf(c)} transform={transform}>
                    {c.members.map((peak, i) => {
                      // A spoke stops PEAK_HEIGHT short of the member it
                      // points at, measured along its own ray. A triangle
                      // rises from its anchor point back toward the circle,
                      // so a spoke drawn the whole way would be painted
                      // through the inside of the triangle it points at.
                      // Shortening along the ray is right in every direction;
                      // stopping at the base or the apex would only be right
                      // straight above or below. The ring is never tighter
                      // than FAN_RADIUS_PX, so a spoke is never shorter than
                      // FAN_RADIUS_PX - PEAK_HEIGHT and never turns around.
                      const { dx, dy } = offsets[i];
                      const length = Math.hypot(dx, dy);
                      const k = (length - PEAK_HEIGHT) / length;
                      return (
                        <line
                          key={`s${peak.mountain.id}`}
                          className="fan-spoke"
                          x1={0}
                          y1={0}
                          x2={dx * k}
                          y2={dy * k}
                        />
                      );
                    })}

                    <g
                      className="fan-anchor"
                      role="button"
                      tabIndex={0}
                      aria-label={`Draw these ${c.members.length} peaks back together`}
                      onClick={() => setFannedId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setFannedId(null);
                        }
                      }}
                    >
                      {/* Same generous invisible target PeakMarker uses,
                          reusing its class rather than a second transparent-
                          fill rule. 11px is safe here too: the nearest
                          fanned peak sits FAN_RADIUS_PX (28px) away. */}
                      <circle className="peak-target" r={11} />
                      <circle className="fan-anchor-dot" r={3} />
                    </g>

                    {/* Ordinary peak markers at the offsets: fill, number,
                        name, hit target, focus ring, keyboard activation and
                        card all come from the component that already exists.
                        A fan is a placement, not a new kind of marker. */}
                    {c.members.map((peak, i) => (
                      <g
                        key={`m${peak.mountain.id}`}
                        transform={`translate(${offsets[i].dx} ${offsets[i].dy})`}
                      >
                        <PeakMarker
                          fill={fillFor(peak.mountain)}
                          selected={openId === peak.mountain.id}
                          number={peak.mountain.fukadaNumber}
                          name={scale >= NAME_SCALE ? peak.mountain.nameEn : null}
                          label={`${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`}
                          onActivate={() => setOpenId(peak.mountain.id)}
                        />
                      </g>
                    ))}
                  </g>
                );
              }

              const done = c.members.filter((m) => fillFor(m.mountain) === 1).length;
              return (
                <g key={keyOf(c)} transform={transform}>
                  <ClusterMarker
                    count={c.members.length}
                    fill={done / c.members.length}
                    label={`${c.members.length} peaks, ${done} climbed by everyone selected. ${
                      scale >= MAX_SCALE ? "Show them separately." : "Zoom in."
                    }`}
                    onActivate={() => {
                      // Zoom until you can't, then fan. At the cap fitBounds
                      // would clamp to the scale already in force and tween
                      // to the camera it started from, which is exactly the
                      // click that used to do nothing.
                      if (scale >= MAX_SCALE) {
                        setFannedId(keyOf(c));
                        return;
                      }
                      fitBounds(
                        Math.min(...c.members.map((m) => m.x)),
                        Math.min(...c.members.map((m) => m.y)),
                        Math.max(...c.members.map((m) => m.x)),
                        Math.max(...c.members.map((m) => m.y)),
                      );
                    }}
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
        {COASTLINE_NOTE[source]}
        {prefectures.length > 0
          ? " Prefectural borders are the GSI Global Map, thinned to match."
          : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}{" "}
        The <span lang="ja">一覧</span> table lists every peak in full.
      </p>
    </div>
  );
}
