"use client";

import { useMemo } from "react";
import { cluster } from "@/lib/map/cluster.mjs";
import { project } from "@/lib/map/projection.mjs";
import { type Entry, type Mountain, key } from "../checklist";

// Screen pixels below which two peaks merge into a ridge. A triangle is 14px
// wide, so this leaves a clear gap between neighbours.
const MIN_SEPARATION_PX = 22;

// The widest English name ("Mt. Echigo-Komagatake") reaches roughly 113px
// past its anchor, estimated from average Georgia character width at the
// label's font size -- not a measurement, since this repo has no headless
// canvas to render text with. A ~30% margin over that estimate absorbs the
// error a real measurement might reveal; the cost is a few names that could
// have safely shown but don't, which is the right side to err on, since a
// missing name is invisible and a colliding one is not.
export const NAME_ROOM_PX = 150;

type PlacedPeak = {
  order: number;
  x: number;
  y: number;
  mountain: Mountain;
};

export function useMapMarkers({
  mountains,
  entries,
  selectedIds,
  unitsPerPixel,
}: {
  mountains: Mountain[];
  entries: Record<string, Entry>;
  selectedIds: number[];
  unitsPerPixel: number;
}) {
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
  // collide, so it must not pay for a reclustering. Each cluster carries its
  // own screen-pixel distance to its nearest other cluster rather than
  // returning that alongside as a parallel array: a name label's reach
  // (NAME_ROOM_PX) is far bigger than the clustering guarantee, so whether
  // one fits is a separate question from whether the peak is clustered at
  // all, but the two must never be able to drift out of index-alignment —
  // attaching the distance to the cluster it describes makes that
  // impossible rather than merely true today.
  const clusters = useMemo(() => {
    const raw = cluster(placed, MIN_SEPARATION_PX * unitsPerPixel);
    return raw.map((c) => {
      let nearestNeighborPx = Infinity;
      for (const other of raw) {
        if (other === c) continue;
        const dMapUnits = Math.hypot(c.x - other.x, c.y - other.y);
        nearestNeighborPx = Math.min(nearestNeighborPx, dMapUnits / unitsPerPixel);
      }
      return { ...c, nearestNeighborPx };
    });
  }, [placed, unitsPerPixel]);

  const total = placed.length;

  // Deliberately off `placed`, not `clusters`: these counts describe the
  // whole map and must not move with zoom. A cluster's member count happens
  // to sum to placed.length -- settle() only merges and splices, it never
  // drops or duplicates a peak -- but relying on that would recluster on
  // every zoom step just to recover a number already in hand, and would read
  // it off a placeholder threshold before the first measurement.
  const fullyClimbed = useMemo(() => {
    if (selectedIds.length === 0) return 0;
    return placed.filter((p) => fillFor(p.mountain) === 1).length;
  }, [placed, entries, selectedIds]);

  return { clusters, fillFor, missing, total, fullyClimbed };
}
