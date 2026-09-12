// Greedy single-pass clustering over at most 100 points.
//
// Sorting happens in here rather than at the call site on purpose: the output
// has to be identical across renders or the map flickers while you zoom, and
// that guarantee is worth more than trusting every caller to pass a stable
// order. `order` is the caller's tie-break key -- the map uses Fukada number.
// For the determinism guarantee to hold, `order` must be a total order with
// no ties: two points sharing an `order` fall back to their position in the
// caller's array, which reintroduces the exact flicker this module exists to
// prevent.

function recentre(c) {
  c.x = c.members.reduce((sum, m) => sum + m.x, 0) / c.members.length;
  c.y = c.members.reduce((sum, m) => sum + m.y, 0) / c.members.length;
}

// Recentring a cluster as members join can pull it back within minSeparation
// of one it had already cleared, leaving two markers drawn on top of each
// other. Merging until no pair is too close restores the guarantee the
// caller actually relies on: that final positions are far enough apart.
// Terminates because every merge removes a cluster.
function settle(clusters, minSeparation) {
  for (let merged = true; merged; ) {
    merged = false;
    search: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (Math.hypot(clusters[i].x - clusters[j].x, clusters[i].y - clusters[j].y) > minSeparation) {
          continue;
        }
        clusters[i].members.push(...clusters[j].members);
        // Keep members in `order`, so members[0] is still the lowest-order
        // peak and the caller's React key stays stable.
        clusters[i].members.sort((a, b) => a.order - b.order);
        recentre(clusters[i]);
        clusters.splice(j, 1);
        merged = true;
        break search;
      }
    }
  }
}

/**
 * @param {{order: number, x: number, y: number}[]} points
 * @param {number} minSeparation distance at or below which two points merge
 */
export function cluster(points, minSeparation) {
  const clusters = [];

  for (const point of [...points].sort((a, b) => a.order - b.order)) {
    const home = clusters.find(
      (c) => Math.hypot(c.x - point.x, c.y - point.y) <= minSeparation,
    );

    if (!home) {
      clusters.push({ x: point.x, y: point.y, members: [point] });
      continue;
    }

    home.members.push(point);
    // Recentre on the running centroid so a long chain of points does not drag
    // the cluster marker away from the peaks it stands for.
    recentre(home);
  }

  settle(clusters, minSeparation);

  return clusters;
}
