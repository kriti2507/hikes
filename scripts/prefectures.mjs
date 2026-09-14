// Converts the GSI Global Map municipality polygons into db/prefectures.json,
// the open [lat, lon] chains that scripts/build-map.mjs projects into the
// dashed prefectural borders on the map.
//
// Like scripts/natural-earth.mjs this is run by hand when the source data
// changes, not as part of the build, and its output is committed so that
// `npm run map:build` stays reproducible offline.
//
//   npm pack jpn-atlas@1.0.2            # 11MB, do not commit
//   tar xzf jpn-atlas-1.0.2.tgz
//   node scripts/prefectures.mjs package/build/polbnda_jpn
//   npm run map:build
//
// Provenance of the committed db/prefectures.json:
//   Global Map Japan 2.2 (2016) polbnda_jpn, 国土地理院 / Geospatial Information
//   Authority of Japan, gsi.go.jp/kankyochiri/gm_jpn.html. Shipped verbatim
//   inside jpn-atlas@1.0.2 (github.com/biskwikman/jpn-atlas, BSD-3-Clause),
//   which is only used here as a download mirror -- its own japan.json is
//   pre-projected into an 850x680 viewport and so cannot go through
//   lib/map/projection.mjs, which is the one thing this pipeline requires.
//   sha256(jpn-atlas-1.0.2.tgz) = ab6cd808f2f89d86ff2b19ba5a24eb1ded237d91199d5543d7120b600b1fcbe9
//   sha256(polbnda_jpn.shp)     = a9ddbf65ed3a59a39552974f5e59c2d790b1c47cab0ade964a35661e1f38229a
//   sha256(polbnda_jpn.dbf)     = 1a6498a58b838f4b85c5e32e25399467e62c33f6668d910efa445ab09a6130f1
//
// Global Map data is free to use with the source credited.
//
// Why a different provider from the coastline: Natural Earth's 1:10m admin-0
// countries file, which scripts/natural-earth.mjs reads, has no sub-national
// lines at all. The two sources disagree by well under the ~1km this map
// claims, so a border reaches its coast close enough to look joined; at the
// 16x zoom limit a few of them stop a pixel or two short of the shore.
import { readFileSync, writeFileSync } from "node:fs";
import { project, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX } from "../lib/map/projection.mjs";
import { ringContains } from "../lib/map/rings.mjs";

// --- Tuning -----------------------------------------------------------------

// Douglas-Peucker tolerance, in map units, matching scripts/natural-earth.mjs
// so that a border and the coast it runs to are thinned by the same amount.
// One unit is about 1.5km. See that script for why 0.3 is the number.
const TOLERANCE = 0.3;

// Four decimal places, about 11m of latitude: far finer than the source, and
// it keeps the committed file to a readable width.
const PRECISION = 4;

// --- Shapefile --------------------------------------------------------------
//
// Enough of the two formats to read one polygon layer and one column. Both are
// fixed-offset binary records, and pulling in a shapefile library for this much
// would break the repo's zero-runtime-dependency shape.

/** One column out of a dBASE III table, as trimmed strings in record order. */
function dbfColumn(path, wanted) {
  const buffer = readFileSync(path);
  const records = buffer.readInt32LE(4);
  const headerLength = buffer.readInt16LE(8);
  const recordLength = buffer.readInt16LE(10);

  // Field descriptors run from byte 32 until a 0x0D terminator. Records are
  // the fields laid end to end after a one-byte deletion flag.
  let offset = 1;
  let field = null;
  for (let at = 32; buffer[at] !== 0x0d; at += 32) {
    const name = buffer.toString("latin1", at, at + 11).replace(/\0.*/, "");
    const length = buffer[at + 16];
    if (name === wanted) {
      field = { offset, length };
      break;
    }
    offset += length;
  }
  if (!field) throw new Error(`${path}: no ${wanted} column`);

  const column = [];
  for (let i = 0; i < records; i++) {
    const at = headerLength + i * recordLength + field.offset;
    column.push(buffer.toString("latin1", at, at + field.length).trim());
  }
  return column;
}

/** Every ring of every polygon record, as [lat, lon], one array per record.
    Parts are not separated into outer rings and holes: this script only ever
    asks which polygons an edge belongs to, and a hole's edges answer that the
    same way an outer ring's do. */
function shpRings(path) {
  const buffer = readFileSync(path);
  const shapes = [];
  let at = 100; // the file header
  while (at < buffer.length) {
    const contentWords = buffer.readInt32BE(at + 4); // record headers are big-endian
    const record = at + 8;
    const type = buffer.readInt32LE(record);
    if (type !== 5) throw new Error(`${path}: shape type ${type}, expected 5 (polygon)`);

    const parts = buffer.readInt32LE(record + 36);
    const points = buffer.readInt32LE(record + 40);
    const partsAt = record + 44;
    const pointsAt = partsAt + parts * 4;

    const rings = [];
    for (let part = 0; part < parts; part++) {
      const from = buffer.readInt32LE(partsAt + part * 4);
      const to = part + 1 < parts ? buffer.readInt32LE(partsAt + (part + 1) * 4) : points;
      const ring = [];
      for (let i = from; i < to; i++) {
        const point = pointsAt + i * 16;
        ring.push([buffer.readDoubleLE(point + 8), buffer.readDoubleLE(point)]); // [lat, lon]
      }
      rings.push(ring);
    }
    shapes.push(rings);
    at = record + contentWords * 2;
  }
  return shapes;
}

// --- Run --------------------------------------------------------------------

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/prefectures.mjs <path/to/polbnda_jpn>");
  console.error("(no extension -- .shp and .dbf are both read)");
  console.error("see the header of this file for where to get that");
  process.exit(1);
}

const base = input.replace(/\.(shp|dbf)$/, "");
const codes = dbfColumn(`${base}.dbf`, "adm_code");
const names = dbfColumn(`${base}.dbf`, "nam");
const shapes = shpRings(`${base}.shp`);
if (codes.length !== shapes.length) {
  throw new Error(`${codes.length} attribute rows for ${shapes.length} shapes`);
}

// --- Dissolve ---------------------------------------------------------------
//
// The source is 2,914 municipalities, not 47 prefectures, so the prefectural
// borders have to be recovered from them. Merging the municipalities into
// prefecture polygons first and then intersecting those is the long way round:
// adjacent municipalities share their dividing edge vertex for vertex, so it is
// enough to ask, of every edge in the file, which prefectures use it.
//
//   used by one polygon         -- the coast, or the edge of the data
//   used by two, same prefecture -- an internal municipal line
//   used by two, different       -- a prefectural border, which is what we want
//
// Dropping the coast rather than keeping it is the point: the coastline on this
// map comes from Natural Earth, and a second, slightly different shoreline
// drawn over it in dashes would show the disagreement between the two sources
// as a doubled line.

const point = (p) => `${p[0]},${p[1]}`;
const edgeKey = (a, b) => (point(a) < point(b) ? `${point(a)}|${point(b)}` : `${point(b)}|${point(a)}`);

const edges = new Map();
shapes.forEach((rings, i) => {
  // A handful of polygons carry adm_code "UNK" -- Global Map's marker for an
  // area it does not assign. Left in, each would contribute a one-sided edge
  // that no prefecture claims, which is dropped below anyway; skipping them
  // here says so out loud.
  if (!/^\d{5}$/.test(codes[i])) return;
  const prefecture = codes[i].slice(0, 2);
  for (const ring of rings) {
    for (let j = 0; j < ring.length - 1; j++) {
      const key = edgeKey(ring[j], ring[j + 1]);
      let edge = edges.get(key);
      if (!edge) edges.set(key, (edge = { a: ring[j], b: ring[j + 1], prefectures: new Map() }));
      edge.prefectures.set(prefecture, names[i]);
      if (edge.prefectures.size > 2) {
        throw new Error(`the edge at ${point(ring[j])} borders three prefectures`);
      }
    }
  }
});

const borders = [...edges.values()].filter((edge) => edge.prefectures.size === 2);
if (borders.length === 0) throw new Error("no edge is shared by two prefectures");

// --- Stitch -----------------------------------------------------------------
//
// The border edges are an unordered soup; drawing them one <path> each would be
// twelve thousand paths. They are walked into runs instead, which also gives
// simplification something to work on: a tolerance applied to a lone segment
// can only keep it.

const touching = new Map();
for (const edge of borders) {
  for (const end of [edge.a, edge.b]) {
    const key = point(end);
    if (!touching.has(key)) touching.set(key, []);
    touching.get(key).push(edge);
  }
}
const degree = (p) => touching.get(point(p)).length;

const walked = new Set();

/** Follow edges from `start` until the run reaches a point where three borders
    meet, a point where one ends at the coast, or its own tail. Breaking at
    junctions matters for more than tidiness: a run carried straight through one
    would let simplification cut the corner off a three-prefecture meeting
    point, pulling the border away from where the other two lines still join. */
function walk(start, first) {
  const chain = [start];
  let here = start;
  let edge = first;
  for (;;) {
    walked.add(edge);
    const next = point(edge.a) === point(here) ? edge.b : edge.a;
    chain.push(next);
    here = next;
    if (degree(here) !== 2) break;
    const onward = touching.get(point(here)).find((candidate) => !walked.has(candidate));
    if (!onward) break; // a closed loop, back at its own start
    edge = onward;
  }
  return chain;
}

const chains = [];
// Every run that has an end -- a coast landing or a junction -- starts at one.
for (const [key, list] of touching) {
  if (list.length === 2) continue;
  for (const edge of list) {
    if (walked.has(edge)) continue;
    chains.push(walk(point(edge.a) === key ? edge.a : edge.b, edge));
  }
}
// What is left is a border that is a closed loop with no junction on it: one
// prefecture entirely surrounded by one other. Any starting point will do.
for (const edge of borders) {
  if (!walked.has(edge)) chains.push(walk(edge.a, edge));
}

// Each chain has one more point than it has edges, and every edge belongs to
// exactly one chain -- so this identity holds only if the walk neither dropped
// a run nor traced one twice.
const stitched = chains.reduce((n, chain) => n + chain.length, 0);
if (stitched !== borders.length + chains.length) {
  throw new Error(`stitched ${stitched} points from ${borders.length} edges in ${chains.length} chains`);
}

// --- Simplify ---------------------------------------------------------------

const perpendicular = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length;
};

/** Douglas-Peucker over an open run, returning the indexes it keeps. Simpler
    than the closed-ring version in scripts/natural-earth.mjs, which has to
    invent the two endpoints this one is handed. */
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

function simplify(chain, tolerance) {
  const points = chain.map(([lat, lon]) => project(lat, lon));
  const keep = new Set([0, points.length - 1]);
  simplifyRun(points, 0, points.length - 1, tolerance, keep);
  return [...keep].sort((a, b) => a - b).map((i) => chain[i]);
}

// --- Write ------------------------------------------------------------------

const inExtent = ([lat, lon]) => lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;

// A border leaving the extent would be clipped to a straight run along the edge
// of the map, so it is dropped whole, the way natural-earth.mjs drops an island
// that does not fit. Okinawa, the one prefecture wholly outside the extent, has
// no land border to drop in the first place.
const inside = chains.filter((chain) => chain.every(inExtent));

const round = (n) => Number(n.toFixed(PRECISION));

const between = (chain) => {
  const key = edgeKey(chain[0], chain[1]);
  return [...edges.get(key).prefectures.values()].sort().join(" | ");
};

const simplified = inside.map((chain) => ({
  // A pair of prefectures can be adjacent along more than one run -- across a
  // junction, or around a strait -- so the name is a label, not a key.
  name: between(chain),
  points: simplify(chain, TOLERANCE).map((p) => p.map(round)),
}));

// The Inland Sea has islets that two prefectures divide between them and that
// this map's coastline does not draw: Natural Earth omits some at 1:10m, and
// scripts/natural-earth.mjs drops others as too small to see. Their borders are
// real, but with no island under them they would render as a few dashes adrift
// in open water, so a run has to touch drawn land somewhere to be kept.
//
// One point is enough, and it has to be: a border landing at the coast usually
// has its last point just offshore of where the other provider puts the
// shoreline. That disagreement is a fraction of the kilometre this map claims
// -- see test/geometry.test.mjs, which holds it to a limit -- whereas an islet
// the coastline never drew misses by the width of the sea around it.
const land = JSON.parse(readFileSync(new URL("../db/coastline.json", import.meta.url))).coastline.map(
  (ring) => ring.points.map(([lat, lon]) => project(lat, lon)),
);
const onLand = (run) =>
  run.points.some(([lat, lon]) => {
    const at = project(lat, lon);
    return land.some((ring) => ringContains(ring, at));
  });

const output = simplified.filter(onLand);
for (const run of simplified.filter((run) => !onLand(run))) {
  console.log(`  dropped ${run.name}: ${run.points.length} points, none on drawn land`);
}

const PER_LINE = 4;
const body = output
  .map((chain) => {
    const lines = [];
    for (let i = 0; i < chain.points.length; i += PER_LINE) {
      lines.push(
        `        ${chain.points.slice(i, i + PER_LINE).map((p) => `[${p[0]}, ${p[1]}]`).join(", ")}`,
      );
    }
    return `    {\n      "name": ${JSON.stringify(chain.name)},\n      "points": [\n${lines.join(",\n")}\n      ]\n    }`;
  })
  .join(",\n");

const file = `{
  "_comment": [
    "Generated by scripts/prefectures.mjs -- do not edit by hand.",
    "Global Map Japan 2.2 municipality polygons, 国土地理院 (Geospatial",
    "Information Authority of Japan), via jpn-atlas@1.0.2. See that script's",
    "header for the checksums and the command that reproduces this file.",
    "These are the prefectural borders only: every edge the source gives to two",
    "different prefectures, stitched into open runs and simplified to",
    "${TOLERANCE} map units, about 450m. Coastal edges are not here -- the",
    "coastline in db/coastline.json is Natural Earth and draws those. Nor are",
    "the few borders that divide an Inland Sea islet that coastline omits.",
    "Points are [latitude, longitude]; a run does NOT close back on itself.",
    "Stored as coordinates rather than SVG so that scripts/build-map.mjs pushes",
    "this through the same projection as the coastline and the summits."
  ],
  "source": "gsi-global-map",
  "borders": [
${body}
  ]
}
`;

writeFileSync(new URL("../db/prefectures.json", import.meta.url), file);

const before = chains.reduce((n, chain) => n + chain.length, 0);
const after = output.reduce((n, chain) => n + chain.points.length, 0);
console.log(
  `wrote db/prefectures.json: ${output.length} of ${chains.length} runs, ` +
    `${after} of ${before} points, from ${borders.length} of ${edges.size} edges`,
);
