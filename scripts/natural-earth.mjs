// Converts Natural Earth's Japan polygon into db/coastline.json, the [lat, lon]
// ring format that scripts/build-map.mjs projects.
//
// This is the simplification step build-map.mjs deliberately does not do. Raw
// Natural Earth is 6,942 points across 109 polygons for Japan; committing that
// verbatim would make every regeneration an unreviewable diff, and most of it is
// detail finer than the source's own ~1km accuracy. This script drops what the
// map cannot show and keeps what it can.
//
// Run it by hand when the source data changes -- not as part of the build. Its
// output is committed, so `npm run map:build` stays reproducible offline.
//
//   npm pack world-atlas@2.0.2          # 8MB, do not commit
//   tar xzf world-atlas-2.0.2.tgz
//   node scripts/natural-earth.mjs package/countries-10m.json
//   npm run map:build
//
// Provenance of the committed db/coastline.json:
//   world-atlas@2.0.2 (github.com/topojson/world-atlas), built from Natural
//   Earth 1:10m admin-0 countries, feature id 392.
//   sha256(world-atlas-2.0.2.tgz)  = 032e7765f2ce00edaeafec23ff22bc3b77e42987c257da944cc585b452c05b97
//   sha256(countries-10m.json)     = 3bc6f1d367a9bcec479841bae0e76092f512838411d0cef124e92eec4db45f79
// @cublya/world-atlas@3.0.0-beta.2, built from Natural Earth 5.1.2, yields a
// byte-identical Japan polygon, so either package reproduces this file.
//
// Natural Earth is public domain; world-atlas is ISC.
import { readFileSync, writeFileSync } from "node:fs";
import {
  project,
  LAT_MIN,
  LAT_MAX,
  LON_MIN,
  LON_MAX,
} from "../lib/map/projection.mjs";
import { ringArea, ringContains } from "../lib/map/rings.mjs";

// --- Tuning -----------------------------------------------------------------
//
// All three are in map units, so they mean the same thing everywhere on the
// map. One unit is about 1.5km; at the 16x zoom limit one unit is roughly 10
// screen pixels, and at fit zoom it is well under one.

// Douglas-Peucker tolerance. At 0.3 a simplified edge sits within ~3px of the
// true one even at full zoom, which is inside the accuracy Natural Earth claims
// for 1:10m data in the first place.
const TOLERANCE = 0.3;

// Rings smaller than this are dropped. A square this size is under 4px on a
// side at full zoom and invisible at fit zoom -- Japan has hundreds of such
// islets and they would be committed noise. Islands carrying a hyakumeizan are
// kept whatever their size, which is what `kept` below checks for.
const MIN_AREA = 4;

// Four decimal places is about 11m of latitude: far finer than the source, and
// it keeps the committed file to a readable width.
const PRECISION = 4;

// Natural Earth's Japan is one unnamed MultiPolygon, but the four main islands
// should say their own names when a ring fails validation. Each is identified
// by a point that can only be inside it.
const LANDMARKS = [
  { name: "Honshu", lat: 36.2, lon: 138.2 }, // Nagano
  { name: "Hokkaido", lat: 43.06, lon: 141.35 }, // Sapporo
  { name: "Kyushu", lat: 32.8, lon: 130.7 }, // Kumamoto
  { name: "Shikoku", lat: 33.84, lon: 132.77 }, // Matsuyama
];

// --- TopoJSON ---------------------------------------------------------------
//
// Enough of the format to read one feature: arcs are quantised integer deltas,
// and a geometry references them by index, where ~i means arc i reversed. No
// dependency needed for this much, and pulling one in for it would break the
// repo's zero-runtime-dependency shape.

function decodeArcs(topology) {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [y * sy + ty, x * sx + tx]; // [lat, lon] from here on
    });
  });
}

/** Stitch an arc index list into one ring, dropping each arc's shared first
    point and the closing repeat of the start. */
function stitch(arcs, indexes) {
  const ring = [];
  for (const index of indexes) {
    const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
    for (const point of ring.length ? arc.slice(1) : arc) ring.push(point);
  }
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring;
}

// --- Geometry ---------------------------------------------------------------

const inExtent = ([lat, lon]) =>
  lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;

const toMapUnits = (ring) => ring.map(([lat, lon]) => project(lat, lon));

const perpendicular = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length;
};

/** Douglas-Peucker over an open run, returning the indexes it keeps. */
function simplifyRun(points, from, to, tolerance, keep) {
  let worst = 0;
  let at = -1;
  for (let i = from + 1; i < to; i++) {
    const distance = perpendicular(points[i], points[from], points[to]);
    if (distance > worst) {
      worst = distance;
      at = i;
    }
  }
  if (worst <= tolerance) return;
  keep.add(at);
  simplifyRun(points, from, at, tolerance, keep);
  simplifyRun(points, at, to, tolerance, keep);
}

/** Douglas-Peucker adapted to a closed ring. A ring has no endpoints to anchor
    the recursion, so it is cut at point 0 and at the point furthest from it --
    two points any reasonable simplification would keep anyway -- and each half
    is simplified as an open run. */
function simplify(points, tolerance) {
  if (points.length < 4) return points.map((_, i) => i);
  let furthest = 0;
  let worst = -1;
  for (let i = 1; i < points.length; i++) {
    const distance = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
    if (distance > worst) {
      worst = distance;
      furthest = i;
    }
  }
  const keep = new Set([0, furthest]);
  simplifyRun(points, 0, furthest, tolerance, keep);
  // The second half wraps past the end, so it is simplified over a rotated copy
  // and the indexes are mapped back.
  const tail = [...points.slice(furthest), points[0]];
  const tailKeep = new Set();
  simplifyRun(tail, 0, tail.length - 1, tolerance, tailKeep);
  for (const i of tailKeep) keep.add((furthest + i) % points.length);
  return [...keep].sort((a, b) => a - b);
}

// --- Run --------------------------------------------------------------------

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/natural-earth.mjs <countries-10m.json>");
  console.error("see the header of this file for where to get that");
  process.exit(1);
}

const topology = JSON.parse(readFileSync(input));
const arcs = decodeArcs(topology);
const japan = topology.objects.countries.geometries.find((g) => g.id === "392");
if (!japan) throw new Error(`${input}: no country with id 392 (Japan)`);

const peaks = Object.entries(JSON.parse(readFileSync(new URL("../db/coordinates.json", import.meta.url))))
  .filter(([key]) => key !== "_comment")
  .map(([number, peak]) => ({ ...peak, number: Number(number), at: project(peak.lat, peak.lon) }));

// Natural Earth gives Japan as MultiPolygon; each polygon's first arc list is
// its outer ring and any others are holes. Japan has none -- assert rather than
// silently drop one if a future release adds a lake.
const polygons = japan.type === "MultiPolygon" ? japan.arcs : [japan.arcs];
const holes = polygons.filter((polygon) => polygon.length > 1).length;
if (holes > 0) throw new Error(`${holes} polygons have holes; db/coastline.json cannot express them`);

const candidates = polygons
  .map((polygon) => stitch(arcs, polygon[0]))
  .map((ring) => {
    const points = toMapUnits(ring);
    return {
      ring,
      points,
      area: ringArea(points),
      inside: ring.every(inExtent),
      peaks: peaks.filter((peak) => ringContains(points, peak.at)),
    };
  })
  .sort((a, b) => b.area - a.area);

// Rings reaching outside the extent are dropped whole rather than clipped: the
// only one Natural Earth produces is Kuchinoshima, 60km south of the extent and
// mostly below it, and clipping would invent a coastline along the extent edge.
// A peak inside a dropped ring would mean the extent itself is wrong.
const dropped = candidates.filter((c) => !c.inside);
for (const ring of dropped) {
  if (ring.peaks.length > 0) {
    throw new Error(`${ring.peaks[0].name} is on an island that leaves the map extent`);
  }
}

const kept = candidates.filter((c) => c.inside && (c.area >= MIN_AREA || c.peaks.length > 0));

const orphans = peaks.filter((peak) => !kept.some((ring) => ringContains(ring.points, peak.at)));
if (orphans.length > 0) {
  throw new Error(
    `${orphans.length} peaks are not on any kept landmass: ${orphans.map((p) => `${p.name} (${p.lat}, ${p.lon})`).join(", ")}`,
  );
}

const landmarks = new Map();
for (const landmark of LANDMARKS) {
  const at = project(landmark.lat, landmark.lon);
  const ring = kept.find((candidate) => ringContains(candidate.points, at));
  if (!ring) throw new Error(`no kept ring contains ${landmark.name}`);
  landmarks.set(ring, landmark.name);
}

const round = (n) => Number(n.toFixed(PRECISION));

const coastline = kept.map((candidate) => {
  const indexes = simplify(candidate.points, TOLERANCE);
  if (indexes.length < 3) throw new Error("simplification flattened a ring to a line");
  const [lat, lon] = candidate.ring[indexes[0]];
  return {
    name:
      landmarks.get(candidate) ??
      (candidate.peaks.length > 0
        ? `island of ${candidate.peaks[0].name}`
        : `islet ${lat.toFixed(1)}N ${lon.toFixed(1)}E`),
    points: indexes.map((i) => candidate.ring[i].map(round)),
  };
});

// Simplification moves the coastline, so containment is re-checked against what
// is actually written: a peak close to the shore could end up in the sea.
const simplified = coastline.map((ring) => toMapUnits(ring.points));
const stranded = peaks.filter((peak) => !simplified.some((ring) => ringContains(ring, peak.at)));
if (stranded.length > 0) {
  throw new Error(
    `simplification put ${stranded.length} peaks offshore: ${stranded.map((p) => p.name).join(", ")}. Lower TOLERANCE.`,
  );
}

// Points are written several to a line, the way the hand-traced placeholder
// was, so that git diffs stay legible when the source data is next updated.
const PER_LINE = 4;
const body = coastline
  .map((ring) => {
    const lines = [];
    for (let i = 0; i < ring.points.length; i += PER_LINE) {
      lines.push(`        ${ring.points.slice(i, i + PER_LINE).map((p) => `[${p[0]}, ${p[1]}]`).join(", ")}`);
    }
    return `    {\n      "name": ${JSON.stringify(ring.name)},\n      "points": [\n${lines.join(",\n")}\n      ]\n    }`;
  })
  .join(",\n");

const file = `{
  "_comment": [
    "Generated by scripts/natural-earth.mjs -- do not edit by hand.",
    "Natural Earth 1:10m admin-0 countries, feature 392 (Japan), via",
    "world-atlas@2.0.2. See that script's header for the checksums and the",
    "command that reproduces this file.",
    "Points are [latitude, longitude]; each ring closes automatically.",
    "Simplified to ${TOLERANCE} map units and filtered to rings of at least ${MIN_AREA}",
    "square map units, plus any island carrying a hyakumeizan. One map unit is",
    "roughly 1.5km. Stored as coordinates rather than SVG so that",
    "scripts/build-map.mjs pushes this through the same projection as the",
    "summits, which is what keeps the outline and the triangles registered.",
    "Ryukyu, Ogasawara and the Tokara islands fall outside the map extent and",
    "are not here; no hyakumeizan is on any of them."
  ],
  "source": "natural-earth",
  "coastline": [
${body}
  ]
}
`;

writeFileSync(new URL("../db/coastline.json", import.meta.url), file);

const before = candidates.reduce((n, c) => n + c.ring.length, 0);
const after = coastline.reduce((n, r) => n + r.points.length, 0);
console.log(
  `wrote db/coastline.json: ${coastline.length} of ${candidates.length} rings, ` +
    `${after} of ${before} points (${dropped.length} rings outside the extent, ` +
    `${candidates.length - kept.length - dropped.length} under ${MIN_AREA} square units)`,
);
