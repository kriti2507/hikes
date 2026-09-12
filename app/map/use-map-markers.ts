"use client";

import { useMemo } from "react";
import { cluster } from "@/lib/map/cluster.mjs";
import { project } from "@/lib/map/projection.mjs";
import { type Entry, type Mountain, key } from "../checklist";

// Screen pixels below which two peaks merge into a ridge. A triangle is 14px
// wide, so this leaves a clear gap between neighbours.
const MIN_SEPARATION_PX = 22;

// The widest English name ("Mt. Echigo-Komagatake") reaches roughly 113px
// past its anchor at the label's font size. Clustering only guarantees 22px
// between markers, so a name needs its own, much larger clearance — without
// this check a name runs straight across its neighbours' triangles.
export const NAME_ROOM_PX = 120;

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
  // collide, so it must not pay for a reclustering.
  const clusters = useMemo(
    () => cluster(placed, MIN_SEPARATION_PX * unitsPerPixel),
    [placed, unitsPerPixel],
  );

  // Screen-pixel distance from each cluster's centroid to its nearest other
  // cluster, aligned index-for-index with `clusters`. A name label's reach
  // (NAME_ROOM_PX) is far bigger than the clustering guarantee, so whether
  // one fits is a separate question from whether the peak is clustered at
  // all — this is what lets map-view answer it without recomputing distances
  // itself. Same dependency as `clusters`: it is only ever stale together.
  const nearestNeighborPx = useMemo(
    () =>
      clusters.map((c) => {
        let best = Infinity;
        for (const other of clusters) {
          if (other === c) continue;
          const dMapUnits = Math.hypot(c.x - other.x, c.y - other.y);
          best = Math.min(best, dMapUnits / unitsPerPixel);
        }
        return best;
      }),
    [clusters, unitsPerPixel],
  );

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

  return { clusters, nearestNeighborPx, fillFor, missing, total, fullyClimbed };
}
