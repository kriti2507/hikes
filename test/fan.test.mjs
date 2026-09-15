// The ring invariants. A fan exists to make peaks individually touchable, so
// the property that matters is that no two members land closer than the
// distance at which the map would have merged them in the first place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAN_RADIUS_PX, fanOffsets } from "../lib/map/fan.mjs";
import { MIN_SEPARATION_PX } from "../lib/map/cluster.mjs";

// Two is every ridge the real data produces at full zoom; the rest guard the
// formula against a future dataset or a wider separation.
const SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

test("no two fanned members land closer than the clustering threshold", () => {
  for (const n of SIZES) {
    const offsets = fanOffsets(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const gap = Math.hypot(offsets[i].dx - offsets[j].dx, offsets[i].dy - offsets[j].dy);
        assert.ok(
          gap >= MIN_SEPARATION_PX,
          `n=${n}: members ${i} and ${j} are only ${gap.toFixed(1)}px apart`,
        );
      }
    }
  }
});

test("no fanned member is drawn nearer the anchor than the ring radius", () => {
  for (const n of SIZES) {
    for (const { dx, dy } of fanOffsets(n)) {
      assert.ok(Math.hypot(dx, dy) >= FAN_RADIUS_PX - 1e-9, `n=${n}: member inside the ring`);
    }
  }
});

test("the same size fans the same way twice", () => {
  assert.deepEqual(fanOffsets(5), fanOffsets(5));
});

test("a two-peak fan puts one above the anchor and one below", () => {
  const [up, down] = fanOffsets(2);
  assert.ok(Math.abs(up.dx) < 1e-9, "the upper member is off the vertical");
  assert.ok(Math.abs(down.dx) < 1e-9, "the lower member is off the vertical");
  assert.equal(up.dy, -FAN_RADIUS_PX);
  assert.equal(down.dy, FAN_RADIUS_PX);
});

test("a lone member gets one offset on the ring, not one at infinity", () => {
  const offsets = fanOffsets(1);
  assert.equal(offsets.length, 1);
  assert.equal(Math.hypot(offsets[0].dx, offsets[0].dy), FAN_RADIUS_PX);
});

// PEAK_HEIGHT lives in app/map/peak-marker.tsx, a "use client" module this
// runner cannot import -- the same cross-module problem MIN_SEPARATION_PX
// solved by moving into a plain .mjs. Reading the literal out of the source
// text, the same way geometry.test.mjs pins MAX_SCALE from use-pan-zoom.ts,
// lets this test catch the one thing map-view.tsx assumes without checking:
// that a fan-spoke's shortening factor, `(length - PEAK_HEIGHT) / length`,
// never goes negative. That holds only as long as no fanned member is drawn
// nearer the anchor than PEAK_HEIGHT, i.e. only as long as FAN_RADIUS_PX
// exceeds PEAK_HEIGHT.
const peakMarkerSource = readFileSync(
  new URL("../app/map/peak-marker.tsx", import.meta.url),
  "utf8",
);
const peakHeightMatch = peakMarkerSource.match(/export const PEAK_HEIGHT = (\d+);/);

test("a spoke is never long enough to shorten past zero and draw backward", () => {
  assert.ok(
    peakHeightMatch,
    "PEAK_HEIGHT's declaration moved or changed shape in app/map/peak-marker.tsx -- update the regex above",
  );
  const peakHeight = Number(peakHeightMatch[1]);
  assert.ok(
    peakHeight < FAN_RADIUS_PX,
    `PEAK_HEIGHT (${peakHeight}) is no longer less than FAN_RADIUS_PX (${FAN_RADIUS_PX}) -- ` +
      "a fan-spoke's shortening factor in map-view.tsx would go negative and draw the spoke " +
      "backward through the anchor instead of stopping short of the triangle it points at",
  );
});
