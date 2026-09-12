// Ring predicates in map units, shared by scripts/natural-earth.mjs (which uses
// them to decide what to keep) and test/geometry.test.mjs (which uses them to
// check that what was kept still holds the peaks).
//
// Deliberately not imported by the app, so unlike projection.mjs and cluster.mjs
// this file has no .d.mts beside it: nothing in the bundle needs its types.
//
// Both take points already in map units, so they agree with what is drawn
// rather than with an unprojected approximation of it.

/** Shoelace area. The sign is dropped: winding order carries no meaning here,
    because every ring is drawn as its own filled subpath. */
export function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
}

/** Even-odd ray cast: is this point inside the ring? */
export function ringContains(points, { x, y }) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
