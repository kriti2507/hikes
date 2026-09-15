// The registration invariant: the coastline, the borders and the summits are
// three separate data files that only agree because all of them go through
// lib/map/projection.mjs. scripts/natural-earth.mjs and scripts/prefectures.mjs
// check this when they convert, but those scripts need a download to run. These
// tests check the committed set, so a hand-edited coordinate or a re-simplified
// coastline cannot quietly put a peak out to sea.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { project, WIDTH, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX } from "../lib/map/projection.mjs";
import { cluster, MIN_SEPARATION_PX } from "../lib/map/cluster.mjs";
import { ringArea, ringContains } from "../lib/map/rings.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../db/${name}`, import.meta.url)));

const geometry = read("coastline.json");
const borders = read("prefectures.json").borders;

/** Shortest distance in map units from a point to a ring's outline -- not to
    its nearest vertex, which on a thinned coastline can be a long way along an
    edge the point is sitting right on. */
function distanceToRing(points, { x, y }) {
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const along = length === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / length));
    nearest = Math.min(nearest, Math.hypot(x - a.x - along * dx, y - a.y - along * dy));
  }
  return nearest;
}
const rings = geometry.coastline.map((ring) => ({
  name: ring.name,
  points: ring.points.map(([lat, lon]) => project(lat, lon)),
}));
const peaks = Object.entries(read("coordinates.json"))
  .filter(([key]) => key !== "_comment")
  .map(([number, peak]) => ({ ...peak, number: Number(number) }));

test("every peak is on land", () => {
  const stranded = peaks.filter((peak) => {
    const at = project(peak.lat, peak.lon);
    return !rings.some((ring) => ringContains(ring.points, at));
  });
  assert.deepEqual(
    stranded.map((peak) => `${peak.number} ${peak.name}`),
    [],
    "peaks fell outside every coastline ring",
  );
});

test("all 100 peaks have coordinates", () => {
  assert.equal(peaks.length, 100);
});

test("the coastline stays inside the projected extent", () => {
  for (const ring of geometry.coastline) {
    for (const [lat, lon] of ring.points) {
      assert.ok(
        lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX,
        `${ring.name}: [${lat}, ${lon}] is outside the map extent`,
      );
    }
  }
});

test("no ring is degenerate", () => {
  for (const ring of rings) {
    // Three points is the minimum that encloses anything, and a ring that
    // survived simplification as a zero-area sliver would draw as an invisible
    // line rather than an island.
    assert.ok(ring.points.length >= 3, `${ring.name}: only ${ring.points.length} points`);
    assert.ok(ringArea(ring.points) > 0, `${ring.name}: encloses no area`);
  }
});

test("every prefectural border stays inside the projected extent", () => {
  for (const run of borders) {
    for (const [lat, lon] of run.points) {
      assert.ok(
        lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX,
        `${run.name}: [${lat}, ${lon}] is outside the map extent`,
      );
    }
  }
});

test("every prefectural border is a run, not a ring", () => {
  for (const run of borders) {
    // Two points is the minimum that draws a line. The map styles these with
    // fill: none and no Z, so a run that closed on itself would be drawing a
    // border twice rather than an outline once -- the shape a bad stitch makes.
    assert.ok(run.points.length >= 2, `${run.name}: only ${run.points.length} points`);
    const [first] = run.points;
    const last = run.points[run.points.length - 1];
    assert.notDeepEqual(first, last, `${run.name}: starts and ends at the same point`);
  }
});

test("every prefectural border stays on or beside the drawn coast", () => {
  // The borders come from the Geospatial Information Authority and the
  // coastline from Natural Earth, so this is the seam between two providers.
  // Where a border lands at the sea the two disagree about exactly where the
  // shoreline is, and the border's last point can fall just outside the drawn
  // one -- most by a few hundred metres, worst by about 1.5km, along the Ariake
  // mudflats that Natural Earth smooths hardest. Three map units is about
  // 4.5km: loose enough for that seam, tight enough that a border adrift in the
  // sea, or a whole run stitched across open water, still fails here.
  const LIMIT = 3;
  const strays = [];
  for (const run of borders) {
    for (const [lat, lon] of run.points) {
      const at = project(lat, lon);
      if (rings.some((ring) => ringContains(ring.points, at))) continue;
      const gap = Math.min(...rings.map((ring) => distanceToRing(ring.points, at)));
      if (gap > LIMIT) strays.push(`${run.name}: [${lat}, ${lon}] is ${gap.toFixed(1)} units offshore`);
    }
  }
  assert.deepEqual(strays, []);
});

test("every prefectural border touches land the map draws", () => {
  // A border over an islet the coastline omits would render as dashes adrift in
  // open water; scripts/prefectures.mjs drops those, and this holds it to it.
  const adrift = borders.filter(
    (run) =>
      !run.points.some(([lat, lon]) => {
        const at = project(lat, lon);
        return rings.some((ring) => ringContains(ring.points, at));
      }),
  );
  assert.deepEqual(adrift.map((run) => run.name), []);
});

test("the four main islands are present and in size order", () => {
  const largest = [...rings]
    .sort((a, b) => ringArea(b.points) - ringArea(a.points))
    .slice(0, 4)
    .map((ring) => ring.name);
  assert.deepEqual(largest, ["Honshu", "Hokkaido", "Kyushu", "Shikoku"]);
});

// MAX_SCALE lives in app/map/use-pan-zoom.ts, a "use client" module this
// runner cannot import, so its value is duplicated here as a literal rather
// than an import. That duplication would normally be a hazard -- someone
// raises the real constant and this file goes on checking a zoom limit that
// no longer exists -- but the test below named "the zoom cap this file
// assumes is the one the map enforces" reads that file as text and fails the
// moment the two disagree, so the duplication cannot drift silently. A narrow
// map is the hard case: MIN_SEPARATION_PX is a screen distance, so converting
// it to map units divides by a units-per-pixel that shrinks as the map gets
// wider. On a wide enough map every pair separates before the zoom limit and
// the fan never triggers.
const MAX_SCALE = 16;
const NARROW_MAP_PX = 600;

test("some peaks cannot be prised apart by zooming alone", () => {
  const unitsPerPixel = WIDTH / MAX_SCALE / NARROW_MAP_PX;
  const merged = cluster(
    peaks.map((peak) => ({ order: peak.number, ...project(peak.lat, peak.lon) })),
    MIN_SEPARATION_PX * unitsPerPixel,
  ).filter((c) => c.members.length > 1);

  assert.ok(
    merged.length > 0,
    "every ridge now splits at maximum zoom -- the fan has nothing left to do",
  );
});

const usePanZoomSource = readFileSync(new URL("../app/map/use-pan-zoom.ts", import.meta.url), "utf8");

test("the zoom cap this file assumes is the one the map enforces", () => {
  assert.match(
    usePanZoomSource,
    new RegExp(`export const MAX_SCALE = ${MAX_SCALE};`),
    "MAX_SCALE moved in app/map/use-pan-zoom.ts -- the test above is now checking a stale zoom limit",
  );
});
