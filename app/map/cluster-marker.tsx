"use client";

import { useId } from "react";

// A ridge: two overlapping peaks, larger than a lone one. Deliberately not a
// single big triangle — that reads as one big mountain until you find the
// number beside it.
const BACK = "M-4 -17L9 0L-17 0Z";
const FRONT = "M10 -11L21 0L-1 0Z";
const RIDGE_HEIGHT = 17;
const RIDGE_LEFT = -17;
const RIDGE_RIGHT = 21;

export function ClusterMarker({
  count,
  fill,
  label,
  onActivate,
}: {
  count: number;
  /** 0 to 1 — how many of its peaks everyone selected has climbed. */
  fill: number;
  label: string;
  onActivate: () => void;
}) {
  const clipId = useId();

  return (
    <g
      className="cluster"
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
      <rect
        className="peak-target"
        x={RIDGE_LEFT - 4}
        y={-RIDGE_HEIGHT - 4}
        width={RIDGE_RIGHT - RIDGE_LEFT + 8}
        height={RIDGE_HEIGHT + 8}
      />

      {fill > 0 ? (
        <>
          <clipPath id={clipId}>
            <path d={BACK} />
            <path d={FRONT} />
          </clipPath>
          <rect
            className="peak-ink"
            x={RIDGE_LEFT}
            y={-RIDGE_HEIGHT * fill}
            width={RIDGE_RIGHT - RIDGE_LEFT}
            height={RIDGE_HEIGHT * fill}
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : null}

      <path className="peak-outline" d={BACK} />
      <path className="peak-outline" d={FRONT} />
      <text className="cluster-count" x={RIDGE_RIGHT + 3} y={-1}>
        {count}
      </text>
    </g>
  );
}
