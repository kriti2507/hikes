// The registration invariant: the coastline and the summits are two separate
// data files that only agree because both go through lib/map/projection.mjs.
// scripts/natural-earth.mjs checks this when it converts, but that script needs
// an 8MB download to run. These tests check the committed pair, so a hand-edited
// coordinate or a re-simplified coastline cannot quietly put a peak out to sea.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { project, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX } from "../lib/map/projection.mjs";
import { ringArea, ringContains } from "../lib/map/rings.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../db/${name}`, import.meta.url)));

const geometry = read("coastline.json");
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

test("the four main islands are present and in size order", () => {
  const largest = [...rings]
    .sort((a, b) => ringArea(b.points) - ringArea(a.points))
    .slice(0, 4)
    .map((ring) => ring.name);
  assert.deepEqual(largest, ["Honshu", "Hokkaido", "Kyushu", "Shikoku"]);
});
