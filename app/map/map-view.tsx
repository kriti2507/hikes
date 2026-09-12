"use client";

import { type CSSProperties, useState } from "react";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { usePanZoom } from "./use-pan-zoom";

export function MapView({
  mountains,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
}) {
  // Callback ref in state rather than useRef: the pan/zoom hook needs to
  // re-run its effects once the element exists, and a ref mutation does not
  // trigger that.
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const { viewBox, handlers } = usePanZoom(element);

  const placed = mountains.filter((m) => m.latitude !== null && m.longitude !== null);
  const missing = mountains.length - placed.length;

  return (
    <div className="map">
      <svg
        ref={setElement}
        className="map-surface"
        viewBox={viewBox}
        // The CSS needs the projection's own dimensions to size the box
        // without letterboxing it (see .map-surface); feeding them in here
        // keeps projection.mjs the only place they are written down.
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
      </svg>

      <p className="map-note">
        Summit positions are approximate — good to about a kilometre.
        {source === "placeholder" ? " The coastline is a schematic placeholder." : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}
      </p>
    </div>
  );
}
