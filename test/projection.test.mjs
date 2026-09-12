import { test } from "node:test";
import assert from "node:assert/strict";
import {
  project,
  LON_MIN,
  LON_MAX,
  LAT_MIN,
  LAT_MAX,
  WIDTH,
  HEIGHT,
} from "../lib/map/projection.mjs";

// Tolerance of 1e-3 map units against a 1000-unit-wide map: four orders of
// magnitude finer than anything visible, but tight enough to catch a changed
// constant or a degrees/radians slip.
const close = (actual, expected, what) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-3,
    `${what}: expected ${expected}, got ${actual}`,
  );

test("the extent corners map to the viewBox corners", () => {
  const nw = project(LAT_MAX, LON_MIN);
  close(nw.x, 0, "north-west x");
  close(nw.y, 0, "north-west y");

  const se = project(LAT_MIN, LON_MAX);
  close(se.x, WIDTH, "south-east x");
  close(se.y, HEIGHT, "south-east y");
});

test("HEIGHT follows from the Mercator aspect rather than being invented", () => {
  close(HEIGHT, 1120.302, "HEIGHT");
});

test("known summits land where they should", () => {
  // Mt. Fuji, from db/coordinates.json.
  const fuji = project(35.3606, 138.7274);
  close(fuji.x, 568.1889, "Fuji x");
  close(fuji.y, 766.2444, "Fuji y");

  // Mt. Rishiri, the northernmost peak.
  const rishiri = project(45.1794, 141.2422);
  close(rishiri.x, 707.9, "Rishiri x");
  close(rishiri.y, 49.1818, "Rishiri y");
});

test("every stored peak falls inside the extent", () => {
  // The extreme peaks, from db/coordinates.json: if these are inside, all 100 are.
  const corners = [
    [30.33, 130.51], // Mt. Miyanoura - southernmost and westernmost
    [45.1794, 141.2422], // Mt. Rishiri - northernmost
    [44.0736, 145.1219], // Mt. Rausu - easternmost
  ];
  for (const [lat, lon] of corners) {
    const { x, y } = project(lat, lon);
    assert.ok(x > 0 && x < WIDTH, `x ${x} outside 0..${WIDTH} for ${lat},${lon}`);
    assert.ok(y > 0 && y < HEIGHT, `y ${y} outside 0..${HEIGHT} for ${lat},${lon}`);
  }
});

test("x rises with longitude and y rises as latitude falls", () => {
  assert.ok(project(35, 130).x < project(35, 140).x, "x should rise eastward");
  assert.ok(project(45, 140).y < project(35, 140).y, "y should rise southward");
});
