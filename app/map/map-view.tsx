"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useState } from "react";
import { coastline, prefectures } from "@/lib/map/japan-geometry";
import { fanOffsets } from "@/lib/map/fan.mjs";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakCard } from "./peak-card";
import { PEAK_HEIGHT, PeakMarker } from "./peak-marker";
import { PersonFilter } from "./person-filter";
import { useMapMarkers } from "./use-map-markers";
import { MAX_SCALE, NAME_SCALE, usePanZoom } from "./use-pan-zoom";

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
  // The key of the cluster whose successor control should take focus once it
  // exists. Opening or collapsing a fan is a deliberate action that unmounts
  // whatever control the user just activated -- the ClusterMarker, the
  // anchor -- before its replacement -- the anchor, the ClusterMarker -- has
  // been drawn. There is nothing to focus at the moment the handler runs, so
  // this remembers the cluster's key across the render that draws the
  // replacement, and the layout effect below resolves it into an actual
  // element once one exists.
  const [focusCluster, setFocusCluster] = useState<string | null>(null);

  const { clusters, fillFor, total, fullyClimbed } = useMapMarkers({
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
    const stillDrawn = clusters.some((c) =>
      c.members.length === 1
        ? c.members[0].mountain.id === openId
        : keyOf(c) === fannedId && c.members.some((m) => m.mountain.id === openId),
    );
    if (stillDrawn) return;

    // This close was not asked for -- a ridge swallowed the open peak on
    // zoom-out, not Escape, the close button, or an outside click -- so the
    // card is about to unmount without ever running its own restore logic.
    // Losing focus to <body> would be worse than not restoring it to the old
    // target: rescue it onto the map surface instead, so the user keeps
    // their place on the map they were just looking at.
    if (document.activeElement?.closest(".peak-card")) element?.focus();
    setOpenId(null);
  }, [clusters, openId, element, fannedId]);

  // A zoom-out collapses the fan outright -- it is no longer the cap, so
  // zooming is the better answer again. But scale is not the only thing that
  // can move the ridges: useMapMarkers reclusters on unitsPerPixel, which a
  // window resize changes without touching scale at all, and that can shift
  // which peak is members[0] of the fanned cluster. When that happens
  // keyOf(c) stops matching fannedId, the ridge falls through to the plain
  // ClusterMarker branch, and a stale fannedId is left pointing at nothing.
  useEffect(() => {
    if (fannedId === null) return;
    const orphaned = !clusters.some((c) => c.members.length > 1 && keyOf(c) === fannedId);
    if (scale >= MAX_SCALE && !orphaned) return;

    // Neither collapse was asked for -- the user zoomed, or resized until the
    // grouping shifted -- and the markers holding focus are about to be
    // removed. Losing focus to <body> would be worse than not restoring it
    // precisely: rescue it onto the map surface, the same way the card's
    // unasked-for close does above. The test is for the fan group rather than
    // for `.peak`, so that a collapse while an ordinary marker elsewhere has
    // focus does not steal it for no reason.
    if (document.activeElement?.closest(".fan")) element?.focus();
    setFannedId(null);
  }, [scale, clusters, fannedId, element]);

  // Opening a fan, and collapsing one via Escape or the anchor, are the three
  // deliberate transitions: the user asked for exactly this change, so unlike
  // the involuntary rescue above there is a real successor control to hand
  // focus to, and it should get it rather than the map surface. The
  // successor cannot be focused from inside the handler that requests it --
  // it is drawn by the render this same state change causes, so it does not
  // exist yet -- which is why this is a separate effect keyed on
  // `focusCluster` rather than a `.focus()` call inline in each handler.
  // `data-cluster` tags both the fanned and the plain-ridge branches with the
  // same key `fannedId` itself uses, so one query serves both directions:
  // right after opening only `.fan-anchor` exists under that key, and right
  // after collapsing only `.cluster` does. useLayoutEffect rather than
  // useEffect so the move lands before paint -- the user should never see a
  // frame with focus sitting on <body>.
  useLayoutEffect(() => {
    if (focusCluster === null) return;
    const control = element?.querySelector(
      `[data-cluster="${focusCluster}"] .fan-anchor, [data-cluster="${focusCluster}"] .cluster`,
    );
    if (control instanceof SVGElement) control.focus();
    setFocusCluster(null);
  }, [focusCluster, fannedId, element]);

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  // Every PeakMarker on the map -- lone or fanned -- takes the same six
  // props computed the same way from its own mountain; only the marker's
  // position (a plain transform on its wrapping <g>) differs between the two
  // call sites. Centralising them here means a future prop cannot drift
  // between the branches by only being updated in one.
  const peakMarkerProps = (peak: { mountain: Mountain }) => ({
    fill: fillFor(peak.mountain),
    selected: openId === peak.mountain.id,
    number: peak.mountain.fukadaNumber,
    // Every peak the map draws on its own gets its name. Above NAME_SCALE two
    // names can still overlap where peaks sit close; the map prefers naming
    // every peak consistently over hiding some to keep others clean.
    name: scale >= NAME_SCALE ? peak.mountain.nameEn : null,
    label: `${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`,
    onActivate: () => setOpenId(peak.mountain.id),
  });

  const [vbX, vbY, vbW] = viewBox.split(" ").map(Number);
  // Only a peak the map draws on its own has a card: a lone cluster, or a
  // member of the ridge currently fanned out. The card anchors to where that
  // peak is *drawn*, which for a fanned member is the ridge's position plus
  // its offset — not the centroid the ridge itself occupies. Deriving this
  // from the clusters rather than searching every member means a peak
  // swallowed into a ridge, or one whose fan just collapsed, loses its card
  // in the same render — no frame where the card floats over a marker that is
  // no longer its peak.
  const open: { mountain: Mountain; x: number; y: number } | null = (() => {
    if (openId === null) return null;
    for (const c of clusters) {
      const index = c.members.findIndex((m) => m.mountain.id === openId);
      if (index < 0) continue;
      if (c.members.length === 1) return c.members[0];
      if (keyOf(c) !== fannedId) return null;
      const { dx, dy } = fanOffsets(c.members.length)[index];
      return {
        mountain: c.members[index].mountain,
        x: c.x + dx * unitsPerPixel,
        y: c.y + dy * unitsPerPixel,
      };
    }
    return null;
  })();

  // Past roughly three-fifths across or down, a card anchored on the near
  // side would hang off the frame, so it flips to the far side instead.
  const cardStyle: React.CSSProperties | null = open
    ? (() => {
        const leftPercent = ((open.x - vbX) / vbW) * 100;
        const topPercent = ((open.y - vbY) / (vbW * (HEIGHT / WIDTH))) * 100;
        // Flipping alone only clears the frame while the frame is wide. The
        // card's own width is a fixed 210px, so on a phone -- a frame of about
        // 340px -- a peak anywhere between roughly a third and two thirds
        // across leaves less than that on either side, and the card hangs off
        // the edge whichever way it faces, taking the page into horizontal
        // scroll with it. `maxWidth` is the room actually left between the
        // anchor and the near edge, so the card gives up width rather than
        // leaving the frame. On a desktop frame it exceeds 210px and nothing
        // changes.
        const horizontal =
          leftPercent > 62
            ? {
                right: `${100 - leftPercent}%`,
                marginRight: "14px",
                maxWidth: `calc(${leftPercent}% - 14px)`,
              }
            : {
                left: `${leftPercent}%`,
                marginLeft: "14px",
                maxWidth: `calc(${100 - leftPercent}% - 14px)`,
              };
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
      <div
        className="map-frame"
        // The CSS needs the projection's dimensions for its aspect ratio and
        // width cap; passing them in keeps projection.mjs the only place they
        // are written down. Same pattern as --tilt in checklist-table.tsx.
        // Set on the frame rather than the surface because the frame is what
        // the cap now applies to, and custom properties inherit downward, so
        // the surface still reads them for its aspect ratio.
        style={{ "--map-w": WIDTH, "--map-h": HEIGHT } as CSSProperties}
      >
        <svg
          ref={setElement}
          className="map-surface"
          viewBox={viewBox}
          {...handlers}
          onKeyDown={(event) => {
            // Only when no card is open. PeakCard listens for Escape on the
            // document for as long as it is mounted, so without this guard one
            // press would close the card and collapse the fan underneath it.
            // Escape should undo one thing at a time: the card, then the fan.
            if (event.key === "Escape" && fannedId !== null && open === null) {
              setFocusCluster(fannedId);
              setFannedId(null);
            }
          }}
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
                return (
                  <g key={keyOf(c)} transform={transform}>
                    <PeakMarker {...peakMarkerProps(peak)} />
                  </g>
                );
              }

              if (keyOf(c) === fannedId) {
                const offsets = fanOffsets(c.members.length);
                // `fan` carries no styles of its own -- it exists so a
                // later focus-rescue check can ask whether the element
                // holding focus sits inside the fan that is about to vanish.
                // `data-cluster` is the other consumer: it is how the
                // focus-successor effect finds this group's `.fan-anchor`
                // right after the ClusterMarker that opened it is gone.
                return (
                  <g className="fan" data-cluster={keyOf(c)} key={keyOf(c)} transform={transform}>
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
                      onClick={() => {
                        setFocusCluster(fannedId);
                        setFannedId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setFocusCluster(fannedId);
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
                        <PeakMarker {...peakMarkerProps(peak)} />
                      </g>
                    ))}
                  </g>
                );
              }

              const done = c.members.filter((m) => fillFor(m.mountain) === 1).length;
              return (
                <g key={keyOf(c)} data-cluster={keyOf(c)} transform={transform}>
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
                        setFocusCluster(keyOf(c));
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

    </div>
  );
}
