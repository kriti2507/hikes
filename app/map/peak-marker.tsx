"use client";

import { useId } from "react";

// Marker dimensions in screen pixels. The parent applies a counter-scale so
// these stay constant however far you zoom.
export const HALF_WIDTH = 7;
export const PEAK_HEIGHT = 11;

/** The triangle, apex up, sitting on its base at y = 0. */
export const PEAK_PATH = `M0 ${-PEAK_HEIGHT}L${HALF_WIDTH} 0L${-HALF_WIDTH} 0Z`;

export function PeakMarker({
  fill,
  label,
  onActivate,
  selected,
}: {
  /** 0 to 1 — how many of the selected people have climbed it. */
  fill: number;
  label: string;
  onActivate: () => void;
  selected: boolean;
}) {
  const clipId = useId();

  return (
    <g
      className={`peak${selected ? " on" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {/* A generous invisible target: the triangle itself is too small to hit
          reliably on a phone. */}
      <circle className="peak-target" cx={0} cy={-PEAK_HEIGHT / 2} r={HALF_WIDTH + 5} />

      {fill > 0 ? (
        <>
          <clipPath id={clipId}>
            <path d={PEAK_PATH} />
          </clipPath>
          {/* Ink rises from the base like a water level. Proportional to height
              rather than area: at 11px, area-proportional fill puts the halfway
              mark uncomfortably low and reads as less than half. */}
          <rect
            className="peak-ink"
            x={-HALF_WIDTH}
            y={-PEAK_HEIGHT * fill}
            width={HALF_WIDTH * 2}
            height={PEAK_HEIGHT * fill}
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : null}

      <path className="peak-outline" d={PEAK_PATH} />
    </g>
  );
}
