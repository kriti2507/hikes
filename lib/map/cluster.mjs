// Greedy single-pass clustering over at most 100 points.
//
// Sorting happens in here rather than at the call site on purpose: the output
// has to be identical across renders or the map flickers while you zoom, and
// that guarantee is worth more than trusting every caller to pass a stable
// order. `order` is the caller's tie-break key -- the map uses Fukada number.

/**
 * @param {{order: number, x: number, y: number}[]} points
 * @param {number} minSeparation distance below which two points merge
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
    home.x = home.members.reduce((sum, m) => sum + m.x, 0) / home.members.length;
    home.y = home.members.reduce((sum, m) => sum + m.y, 0) / home.members.length;
  }

  return clusters;
}
