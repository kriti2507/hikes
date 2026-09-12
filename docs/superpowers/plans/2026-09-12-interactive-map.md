# Interactive Schematic Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zoomable schematic map of Japan beside the existing checklist, with one triangle per peak inked in proportion to how many of the selected people have climbed it, clustering into ridges when peaks collide on screen.

**Architecture:** A fixed Mercator projection is the single source of truth for position. Peaks are projected at runtime from Postgres; the coastline is projected at build time by a generator script from lat/lon control points. Both call the same function with the same extent, so replacing today's hand-traced placeholder outline with real Natural Earth geometry later changes one generated file and moves no triangle. The map renders as inline SVG with a hand-rolled pan/zoom hook — no map library, no tile server, no runtime dependency.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5.9, Postgres via `pg`, `node --test` (built into Node 20). No new runtime or dev dependencies.

**Design spec:** `docs/superpowers/specs/2026-09-12-interactive-map-design.md`

---

## Background you need before starting

**This is not the Next.js you may know.** Per `AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` before writing framework code.

**No backticks inside the SQL comments.** The query in `app/page.tsx` is a JavaScript template literal, so a backtick in a `--` comment terminates the string and produces a baffling `TS1005: ',' expected`. Write `numeric columns`, not `` `numeric` ``.

**`npm run build` needs a `DATABASE_URL`.** `lib/db.ts` builds its pool at module load, so importing it throws `DATABASE_URL is not set` during Next's "collecting page data" phase. In a sandbox that cannot read `.env.local`, pass a dummy value — `DATABASE_URL=postgres://u:p@localhost:5432/db npm run build`. `pg` does not connect when the pool is constructed, and the page is `force-dynamic`, so no query runs at build time. This is the only way to verify that the bundler resolves the `.mjs` imports.

**Four facts about this codebase that will bite you:**

1. **`pg` returns `numeric` columns as JavaScript strings.** `latitude numeric(8,5)` arrives as `"35.36072"`. Every task that touches SQL must cast with `::float8`.
2. **`tsconfig.json` sets `allowJs: false` and the project runs Node 20**, which has no TypeScript stripping. Modules that must run in the browser *and* in a build script *and* under `node --test` are therefore written as plain `.mjs` with a hand-written `.d.mts` beside them. TypeScript reads the `.d.mts` for types; the bundler and Node both load the `.mjs`. Do not duplicate the logic into a `.ts` copy.

   **Import these modules with the `.mjs` extension — always.** `import { project } from "@/lib/map/projection.mjs"`, never `from "@/lib/map/projection"`. This was verified empirically against this repo's `tsconfig.json` (`moduleResolution: "bundler"`, `strict: true`): a `.d.mts` declaration resolves for the extension-ful form and fails `TS2307` for the extensionless one, while a `.d.ts` does the exact opposite. There is no file name that satisfies both, so the project picks one convention: extension-ful. That also matches what Node ESM already forces on `scripts/build-map.mjs` and the test files, giving one rule across all three call sites.

   This applies only to the `.mjs` pair. `lib/map/japan-geometry.ts` is a real TypeScript file and is imported extensionless as normal.
3. **`app/map/` must never contain a `page.tsx` or `route.ts`.** It is a component directory. A `page.tsx` there would create a `/map` route, which this design deliberately does not have.
4. **Commit messages in this repo are plain sentences**, not Conventional Commits. `git log --oneline` shows "switch to light mode default", not "feat: ...". Match that.

**Colour tokens** are already defined for both themes in `app/globals.css`: `--washi` (paper), `--washi-deep`, `--sumi` (ink), `--sumi-soft`, `--sumi-faint`, `--rule` (hairlines), `--bero-ai` (Prussian blue), `--beni` (vermilion). Use them. Do not introduce map-specific colours — dark mode then works for free.

---

## File Structure

**New — pure logic (runs in browser, build script, and test runner):**

| File | Responsibility |
| --- | --- |
| `lib/map/projection.mjs` | `project(lat, lon) → {x, y}`; extent constants; derived `HEIGHT` |
| `lib/map/projection.d.mts` | Types for the above |
| `lib/map/cluster.mjs` | `cluster(points, minSeparation) → Cluster[]`, deterministic |
| `lib/map/cluster.d.mts` | Types for the above |

**New — generated data and its generator:**

| File | Responsibility |
| --- | --- |
| `db/coastline.json` | Placeholder outline as lat/lon control points |
| `scripts/build-map.mjs` | Projects a geometry source into `lib/map/japan-geometry.ts` |
| `lib/map/japan-geometry.ts` | **Generated.** Path data, viewBox, `source` tag |

**New — map components (no `page.tsx` in this directory):**

| File | Responsibility |
| --- | --- |
| `app/map/use-pan-zoom.ts` | Owns `{scale, cx, cy}`; wheel/drag/pinch; derives viewBox and `unitsPerPixel` |
| `app/map/map-view.tsx` | The SVG surface: projects peaks, clusters them, renders everything |
| `app/map/peak-marker.tsx` | One triangle with a fill level; exports shared marker dimensions |
| `app/map/cluster-marker.tsx` | The ridge with a count and a fill level |
| `app/map/peak-card.tsx` | Detail panel with a tick box per person |
| `app/map/person-filter.tsx` | Person chips and the sentence that restates the rule |

**Extracted from the existing 365-line `app/checklist.tsx` (no behaviour change):**

| File | Responsibility |
| --- | --- |
| `app/banner.tsx` | Header print, tallies, `PersonActions` |
| `app/checklist-table.tsx` | The table |
| `app/add-person.tsx` | `AddPerson` form |
| `app/checklist.tsx` | Container: owns `entries`, `save()`, active tab, person selection |

**New — tests:**

| File | Responsibility |
| --- | --- |
| `test/projection.test.mjs` | Known summits, extent corners, monotonicity, aspect |
| `test/cluster.test.mjs` | Determinism, partitioning, threshold behaviour |

**Modified:** `app/page.tsx` (query gains coordinates), `app/globals.css` (map styles), `package.json` (`test` and `map:build` scripts), `README.md`.

---

## Task 1: Test runner and the projection module

**Files:**
- Create: `lib/map/projection.mjs`
- Create: `lib/map/projection.d.mts`
- Create: `test/projection.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the test script**

In `package.json`, add two entries to `"scripts"` (keep the existing ones):

```json
    "test": "node --test test/*.test.mjs",
    "map:build": "node scripts/build-map.mjs"
```

- [ ] **Step 2: Write the failing test**

Create `test/projection.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/map/projection.mjs'`

- [ ] **Step 4: Write the projection**

Create `lib/map/projection.mjs`:

```js
// Spherical Mercator over a fixed extent, shared by three callers: the browser
// (which projects peaks out of the database), scripts/build-map.mjs (which
// projects the coastline), and node --test.
//
// Plain .mjs rather than .ts because Node 20 cannot strip types and tsconfig
// sets allowJs:false; the .d.ts beside this file gives the app full types. Do
// not make a second copy of this maths in TypeScript -- the whole point of the
// design is that the outline and the triangles come from one function.

// Chosen to clear every stored peak with margin: they span latitude 30.33 to
// 45.18 and longitude 130.51 to 145.12.
export const LON_MIN = 128.5;
export const LON_MAX = 146.5;
export const LAT_MIN = 30.0;
export const LAT_MAX = 45.8;

// The map is 1000 units wide by definition; the height is derived below so
// that changing the extent cannot silently stretch the country.
export const WIDTH = 1000;

const RAD = Math.PI / 180;

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));

const X0 = LON_MIN * RAD;
const Y0 = mercatorY(LAT_MAX);
const SCALE = WIDTH / (LON_MAX * RAD - X0);

export const HEIGHT = (Y0 - mercatorY(LAT_MIN)) * SCALE;

/** Summit position to map units. y grows downward, as SVG expects. */
export function project(lat, lon) {
  return { x: (lon * RAD - X0) * SCALE, y: (Y0 - mercatorY(lat)) * SCALE };
}
```

- [ ] **Step 5: Write the type declarations**

Create `lib/map/projection.d.mts`:

```ts
export declare const LON_MIN: number;
export declare const LON_MAX: number;
export declare const LAT_MIN: number;
export declare const LAT_MAX: number;
export declare const WIDTH: number;
export declare const HEIGHT: number;

export declare function project(lat: number, lon: number): { x: number; y: number };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 7: Commit**

```bash
git add package.json lib/map/projection.mjs lib/map/projection.d.mts test/projection.test.mjs
git commit -m "$(cat <<'EOF'
Add the map projection and a test runner

Spherical Mercator over a fixed extent, in plain .mjs so the browser, the
geometry generator and node --test can all load the same file on Node 20.
The viewBox height is derived from the extent rather than hardcoded.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Deterministic clustering

Peaks that land within 22 screen pixels of each other collapse into one ridge. The threshold is in **screen** distance, so clusters split smoothly as you zoom instead of popping at fixed levels.

Determinism matters more than cluster quality here: a clustering that reshuffles between renders makes the map flicker while zooming. The function therefore sorts its input itself rather than trusting the caller's array order.

**Files:**
- Create: `lib/map/cluster.mjs`
- Create: `lib/map/cluster.d.mts`
- Create: `test/cluster.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/cluster.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster } from "../lib/map/cluster.mjs";

const point = (order, x, y) => ({ order, x, y });

// Two tight pairs, far apart from each other.
const POINTS = [
  point(1, 0, 0),
  point(2, 5, 0),
  point(3, 500, 500),
  point(4, 505, 500),
];

const sizes = (clusters) => clusters.map((c) => c.members.length);

test("nearby points collapse and distant ones do not", () => {
  const result = cluster(POINTS, 20);
  assert.equal(result.length, 2);
  assert.deepEqual(sizes(result), [2, 2]);
});

test("a zero separation leaves every point on its own", () => {
  assert.equal(cluster(POINTS, 0).length, 4);
});

test("a huge separation collapses everything into one", () => {
  const result = cluster(POINTS, 10_000);
  assert.equal(result.length, 1);
  assert.equal(result[0].members.length, 4);
});

test("every point lands in exactly one cluster", () => {
  const result = cluster(POINTS, 20);
  const orders = result.flatMap((c) => c.members.map((m) => m.order)).sort();
  assert.deepEqual(orders, [1, 2, 3, 4]);
});

test("the result does not depend on the input array order", () => {
  const shuffled = [POINTS[2], POINTS[0], POINTS[3], POINTS[1]];
  assert.deepEqual(cluster(shuffled, 20), cluster(POINTS, 20));
});

test("the same input twice gives the identical result", () => {
  assert.deepEqual(cluster(POINTS, 20), cluster(POINTS, 20));
});

test("a cluster sits at the centroid of its members", () => {
  const [first] = cluster([point(1, 0, 0), point(2, 10, 20)], 100);
  assert.equal(first.x, 5);
  assert.equal(first.y, 10);
});

test("an empty input gives an empty result", () => {
  assert.deepEqual(cluster([], 20), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/map/cluster.mjs'`

- [ ] **Step 3: Write the clustering**

Create `lib/map/cluster.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 13 tests total (5 projection + 8 cluster), 0 failures

- [ ] **Step 5: Write the type declarations**

Create `lib/map/cluster.d.mts`. The generic carries the caller's own point type
through, so `map-view.tsx` gets `members` back as its own peak objects rather
than as bare coordinates:

```ts
export interface ClusterPoint {
  order: number;
  x: number;
  y: number;
}

export interface Cluster<T extends ClusterPoint = ClusterPoint> {
  x: number;
  y: number;
  members: T[];
}

export declare function cluster<T extends ClusterPoint>(
  points: T[],
  minSeparation: number,
): Cluster<T>[];
```

- [ ] **Step 6: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/map/cluster.mjs lib/map/cluster.d.mts test/cluster.test.mjs
git commit -m "$(cat <<'EOF'
Add deterministic screen-distance clustering for map markers

Sorts its own input so the result cannot change between renders; a
clustering that reshuffles makes the map flicker while zooming.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The coastline and its generator

The outline ships as **lat/lon control points**, not SVG, so that it goes through the same `project()` as the peaks and is registered to the real world rather than eyeballed against the triangles. Swapping in Natural Earth geometry later means pointing this script at a different source and re-running it.

Prefecture borders ship empty. Hand-tracing 47 boundaries as control points is not worth doing for artwork that is about to be replaced; they arrive with the real geometry.

**Files:**
- Create: `db/coastline.json`
- Create: `scripts/build-map.mjs`
- Create (generated): `lib/map/japan-geometry.ts`

- [ ] **Step 1: Write the control points**

Create `db/coastline.json`. Points are `[latitude, longitude]`, traced from named coastal landmarks so a mis-keyed value is obvious on inspection. Each ring closes automatically.

```json
{
  "_comment": [
    "A placeholder outline of Japan, as lat/lon control points rather than SVG.",
    "Stored this way so scripts/build-map.mjs pushes it through the same",
    "projection as the summits -- the coastline and the triangles are then",
    "registered to each other by construction, and replacing this file with",
    "real Natural Earth geometry moves no triangle.",
    "Points are [latitude, longitude], traced from named coastal landmarks so a",
    "mis-keyed value is obvious. Each ring closes automatically.",
    "Schematic only: islands with no hyakumeizan on them are omitted."
  ],
  "source": "placeholder",
  "prefectures": [],
  "coastline": [
    {
      "name": "Hokkaido",
      "points": [
        [45.52, 141.94], [44.36, 143.35], [44.02, 144.27], [44.33, 145.33],
        [43.33, 145.58], [42.98, 144.38], [41.93, 143.25], [42.63, 141.6],
        [42.32, 140.97], [41.77, 140.73], [41.42, 140.12], [42.45, 139.85],
        [43.33, 140.35], [43.94, 141.63], [44.88, 141.74]
      ]
    },
    {
      "name": "Rishiri",
      "points": [
        [45.28, 141.24], [45.22, 141.33], [45.13, 141.31],
        [45.09, 141.21], [45.16, 141.14], [45.25, 141.16]
      ]
    },
    {
      "name": "Honshu",
      "points": [
        [41.53, 140.91], [41.43, 141.46], [40.53, 141.5], [39.64, 141.97],
        [39.07, 141.72], [38.3, 141.5], [38.26, 141.02], [36.95, 140.95],
        [35.71, 140.87], [34.9, 139.89], [35.44, 139.65], [35.14, 139.62],
        [34.6, 138.84], [34.6, 138.23], [34.48, 136.84], [34.28, 136.89],
        [33.44, 135.76], [34.23, 135.16], [34.68, 135.19], [34.6, 133.93],
        [34.35, 132.46], [33.95, 130.94], [34.41, 131.4], [34.9, 132.08],
        [35.43, 132.76], [35.53, 134.23], [35.5, 135.4], [35.65, 136.07],
        [36.06, 136.15], [36.6, 136.62], [36.89, 136.78], [37.53, 137.33],
        [36.77, 137.22], [37.04, 137.86], [37.92, 139.06], [38.92, 139.83],
        [39.76, 140.06], [39.95, 139.7], [40.2, 140.02], [40.78, 140.21],
        [41.26, 140.34], [40.83, 140.75]
      ]
    },
    {
      "name": "Shikoku",
      "points": [
        [34.07, 132.99], [34.35, 134.05], [34.23, 134.64], [33.25, 134.18],
        [33.5, 133.53], [32.72, 133.02], [33.22, 132.56], [33.84, 132.72]
      ]
    },
    {
      "name": "Kyushu",
      "points": [
        [33.95, 130.97], [33.28, 131.5], [32.92, 131.9], [31.91, 131.43],
        [31.37, 131.34], [30.99, 130.66], [31.27, 130.3], [31.72, 130.26],
        [32.74, 129.87], [33.45, 129.97], [33.6, 130.4]
      ]
    },
    {
      "name": "Yakushima",
      "points": [
        [30.45, 130.51], [30.4, 130.65], [30.28, 130.63],
        [30.23, 130.5], [30.3, 130.4], [30.42, 130.4]
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the generator**

Create `scripts/build-map.mjs`. It mirrors `scripts/build-seed.mjs`: read a source, validate it loudly, write a generated artefact.

```js
// Projects a geometry source into lib/map/japan-geometry.ts.
//
// Today the source is db/coastline.json, a hand-traced placeholder. To swap in
// real geometry, convert Natural Earth (or GSI) into the same shape -- rings of
// [lat, lon] under "coastline" and "prefectures", with "source" set to
// "natural-earth" -- and re-run. Nothing downstream changes: the components,
// the peak positions and the tests are all independent of which source ran,
// because both go through lib/map/projection.mjs.
//
// Run with: npm run map:build
import { readFileSync, writeFileSync } from "node:fs";
import { project, WIDTH, HEIGHT, LAT_MIN, LAT_MAX, LON_MIN, LON_MAX } from "../lib/map/projection.mjs";

const source = JSON.parse(readFileSync(new URL("../db/coastline.json", import.meta.url)));

if (source.source !== "placeholder" && source.source !== "natural-earth") {
  throw new Error(`unknown geometry source: ${source.source}`);
}

// A point outside the extent means the projection constants and the geometry
// have drifted apart -- exactly the failure this pipeline exists to prevent, so
// fail the build rather than draw a coastline that runs off the page.
function checkInExtent(ring) {
  for (const [lat, lon] of ring.points) {
    if (lat < LAT_MIN || lat > LAT_MAX || lon < LON_MIN || lon > LON_MAX) {
      throw new Error(`${ring.name}: [${lat}, ${lon}] is outside the map extent`);
    }
  }
}

// Two decimal places on a 1000-unit map is a hundredth of a pixel at fit zoom
// and about a sixth of a pixel at the 16x maximum: far below anything visible,
// and it keeps the generated file readable.
const round = (n) => Math.round(n * 100) / 100;

function toPath(ring) {
  checkInExtent(ring);
  const steps = ring.points.map(([lat, lon], i) => {
    const { x, y } = project(lat, lon);
    return `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
  });
  return `${steps.join("")}Z`;
}

const coastline = (source.coastline ?? []).map(toPath);
const prefectures = (source.prefectures ?? []).map(toPath);

const file = `// Generated by scripts/build-map.mjs -- do not edit by hand.
// Source: db/coastline.json (${source.source}).
//
// Regenerate with: npm run map:build

/** Closed SVG paths in map units, from lib/map/projection.mjs. */
export const coastline: string[] = ${JSON.stringify(coastline, null, 2)};

/** Prefecture boundaries. Empty until the real geometry lands. */
export const prefectures: string[] = ${JSON.stringify(prefectures, null, 2)};

export const viewBox = "0 0 ${round(WIDTH)} ${round(HEIGHT)}";

/** Which geometry is in use, so the page can caption itself honestly. */
export const source = ${JSON.stringify(source.source)} as const;
`;

writeFileSync(new URL("../lib/map/japan-geometry.ts", import.meta.url), file);
console.log(`wrote lib/map/japan-geometry.ts: ${coastline.length} coastline rings, ${prefectures.length} prefecture rings`);
```

- [ ] **Step 3: Run the generator**

Run: `npm run map:build`
Expected: `wrote lib/map/japan-geometry.ts: 6 coastline rings, 0 prefecture rings`

- [ ] **Step 4: Check the generated file**

Run: `head -20 lib/map/japan-geometry.ts`
Expected: a generated-file banner, then `export const coastline: string[] = [` followed by path strings beginning `"M`. Confirm `viewBox` reads `"0 0 1000 1120.3"`.

- [ ] **Step 5: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

The generated file is committed — the app imports it directly, and Vercel does not run the generator.

```bash
git add db/coastline.json scripts/build-map.mjs lib/map/japan-geometry.ts
git commit -m "$(cat <<'EOF'
Add the map geometry generator and a placeholder coastline

The outline is stored as lat/lon control points rather than SVG so it goes
through the same projection as the summits. Pointing the script at Natural
Earth later replaces one generated file and moves no triangle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Load coordinates into the page

**Files:**
- Modify: `app/page.tsx:9-24` (the `mountains` query)
- Modify: `app/checklist.tsx:13-26` (the `Mountain` type)

- [ ] **Step 1: Add the columns to the query**

In `app/page.tsx`, inside the `query<Mountain>` call, add two lines after `also_in as "alsoIn",`:

```sql
              also_in        as "alsoIn",
              -- pg hands back numeric columns as strings, which would put every
              -- triangle at NaN. The cast is not optional.
              latitude::float8  as latitude,
              longitude::float8 as longitude
```

- [ ] **Step 2: Add the fields to the type**

In `app/checklist.tsx`, add to the `Mountain` type after `alsoIn`:

```ts
  alsoIn: string | null;
  // Approximate to roughly a kilometre; see db/coordinates.json. Nullable
  // because the schema allows a mountain to be added without a position.
  latitude: number | null;
  longitude: number | null;
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify the data arrives as numbers**

Start the dev server (`npm run dev`), open `http://localhost:3000`, log in, and confirm the checklist still renders unchanged. Then in `app/page.tsx` temporarily add `console.log(typeof mountains[0].latitude, mountains[0].latitude);` before the `return`, reload, and check the server terminal.

Expected: `number 45.1794` — **not** `string 45.1794`. If it says `string`, the `::float8` cast is missing or misspelled.

Remove the `console.log` before committing.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/checklist.tsx
git commit -m "$(cat <<'EOF'
Load summit coordinates into the checklist page

Cast to float8 in the query: pg returns numeric columns as strings, which
would put every map marker at NaN.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Split `checklist.tsx` (no behaviour change)

`app/checklist.tsx` is 365 lines doing five jobs. Before adding a map to it, split it. **This task changes no behaviour** — it is pure extraction, and the page must look and act identically afterwards.

**Files:**
- Create: `app/banner.tsx`
- Create: `app/checklist-table.tsx`
- Create: `app/add-person.tsx`
- Modify: `app/checklist.tsx`

- [ ] **Step 1: Extract the shared types**

The types currently in `checklist.tsx` are imported by `app/page.tsx`. Keep them exported from `app/checklist.tsx` so that import keeps working, and have the new files import from there. Add this note above the type block in `app/checklist.tsx`:

```ts
// Re-exported from here rather than a types file because app/page.tsx already
// imports them from this path, and moving them would churn that import for no
// gain. Type aliases rather than interfaces: aliases get an implicit index
// signature, which is what lib/db.ts's `query<T>` constraint wants.
```

Also add the shared `Entry` type and `key` helper to the exports, since the table and the map both need them:

```ts
export type Entry = { climbed: boolean; dateClimbed: string | null };

export const key = (personId: number, mountainId: number) => `${personId}:${mountainId}`;
```

- [ ] **Step 2: Create `app/add-person.tsx`**

Move the `AddPerson` function out of `checklist.tsx` verbatim, adding the directive and imports:

```tsx
"use client";

import { useState, useTransition } from "react";
import { addPerson } from "./actions";

export function AddPerson({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <form
      className="add-person"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setFailed(false);
        startTransition(async () => {
          try {
            await addPerson(name);
            setName("");
            onAdded();
          } catch {
            setFailed(true);
          }
        });
      }}
    >
      <label htmlFor="new-person">Add a person</label>
      <input
        id="new-person"
        value={name}
        placeholder="Name"
        onChange={(event) => setName(event.target.value)}
        disabled={pending}
      />
      <button type="submit" disabled={pending || !name.trim()}>
        {pending ? "Adding…" : "Add"}
      </button>
      {failed ? <span className="error">Could not add that person.</span> : null}
    </form>
  );
}
```

Delete `AddPerson` from `app/checklist.tsx`.

- [ ] **Step 3: Create `app/banner.tsx`**

Move the `<header className="banner">` block and the whole `PersonActions` function into it. `PersonActions` is only used by the banner, so it lives here and is not exported.

```tsx
"use client";

import { useState, useTransition } from "react";
import { deletePerson, updatePerson } from "./actions";
import { ThemeToggle } from "./theme-toggle";
import type { Person } from "./checklist";

export function Banner({
  people,
  counts,
  total,
  onChanged,
}: {
  people: Person[];
  counts: Map<number, number>;
  total: number;
  onChanged: () => void;
}) {
  return (
    <header className="banner">
      {/* Decorative: the print carries no information the text does not. */}
      <div className="banner-print" aria-hidden="true" />
      <ThemeToggle />
      <div className="banner-text">
        <h1>
          日本百名山
          <span>
            The Hundred Famous Mountains
            <br />
            Fukada Kyūya, 1964
          </span>
        </h1>
        <ul className="tally">
          {people.map((person) => (
            <li key={person.id}>
              {/* The seal is a fixed square, so edit/delete sit below it rather
                  than inside — the stamp keeps its proportions either way. */}
              <div
                className="tally-seal"
                title={`${person.name}: ${counts.get(person.id) ?? 0} of ${total}`}
              >
                <strong>{counts.get(person.id) ?? 0}</strong>
                <span>{person.name}</span>
              </div>
              <PersonActions person={person} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
```

Then paste the existing `PersonActions` function below it, unchanged.

Delete both the `<header>` block and `PersonActions` from `app/checklist.tsx`.

- [ ] **Step 4: Create `app/checklist-table.tsx`**

Move the `<table>` and the `groups` memo into it:

```tsx
"use client";

import { Fragment, type CSSProperties, useMemo } from "react";
import type { Entry, Mountain, Person } from "./checklist";
import { key } from "./checklist";

// Degrees of tilt a seal can land at, picked by mountain id.
const TILTS = [-3, -1.5, 0, 1.5, 3];

export function ChecklistTable({
  mountains,
  people,
  entries,
  onSave,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
}) {
  // Mountains arrive pre-sorted, so grouping is a single pass that preserves
  // the prefecture order the query chose.
  const groups = useMemo(() => {
    const out: { prefecture: string; prefectureJa: string; mountains: Mountain[] }[] = [];
    for (const m of mountains) {
      const last = out.at(-1);
      if (last?.prefecture === m.prefecture) last.mountains.push(m);
      else out.push({ prefecture: m.prefecture, prefectureJa: m.prefectureJa, mountains: [m] });
    }
    return out;
  }, [mountains]);

  return (
    <table>
      <thead>
        <tr>
          <th className="num">#</th>
          <th className="mountain">Mountain</th>
          <th className="elev">Height</th>
          <th className="season">Best time</th>
          <th className="notes">Notes</th>
          {people.map((person) => (
            <th key={person.id} className="person">
              {person.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.prefecture}>
            <tr className="group">
              <th colSpan={5 + people.length}>
                {group.prefectureJa}
                <span>
                  {group.prefecture} · {group.mountains.length}
                </span>
              </th>
            </tr>
            {group.mountains.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.fukadaNumber ?? "—"}</td>
                <td className="mountain">
                  <span className="kanji">{m.nameKanji}</span>
                  <span className="kana">{m.nameKana}</span>
                  <span className="en">{m.nameEn}</span>
                </td>
                <td className="elev">{m.elevationM.toLocaleString("en-US")} m</td>
                <td className="season">{m.bestSeason ?? "—"}</td>
                <td className="notes">
                  {[m.region, m.notes, m.alsoIn && `also ${m.alsoIn}`].filter(Boolean).join(" · ")}
                </td>
                {people.map((person) => {
                  const entry = entries[key(person.id, m.id)];
                  const climbed = entry?.climbed ?? false;
                  return (
                    <td key={person.id} className="person">
                      <input
                        type="checkbox"
                        checked={climbed}
                        aria-label={`${person.name} climbed ${m.nameEn}`}
                        // A seal is pressed by hand, so no two sit quite square.
                        // Seeding the tilt from the id keeps it stable across
                        // renders — random would reshuffle on every keystroke.
                        style={{ "--tilt": `${TILTS[m.id % TILTS.length]}deg` } as CSSProperties}
                        onChange={(event) =>
                          onSave(person.id, m.id, {
                            climbed: event.target.checked,
                            // Unchecking discards the date: the row means
                            // "not climbed", so a date would contradict it.
                            dateClimbed: event.target.checked ? (entry?.dateClimbed ?? null) : null,
                          })
                        }
                      />
                      {climbed ? (
                        <input
                          type="date"
                          className="date"
                          value={entry?.dateClimbed ?? ""}
                          aria-label={`Date ${person.name} climbed ${m.nameEn}`}
                          onChange={(event) =>
                            onSave(person.id, m.id, { climbed: true, dateClimbed: event.target.value || null })
                          }
                        />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Reduce `app/checklist.tsx` to a container**

Replace the whole file with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setAscent } from "./actions";
import { AddPerson } from "./add-person";
import { Banner } from "./banner";
import { ChecklistTable } from "./checklist-table";

// Re-exported from here rather than a types file because app/page.tsx already
// imports them from this path, and moving them would churn that import for no
// gain. Type aliases rather than interfaces: aliases get an implicit index
// signature, which is what lib/db.ts's `query<T>` constraint wants.
export type Mountain = {
  id: number;
  fukadaNumber: number | null;
  nameKanji: string;
  nameKana: string;
  nameEn: string;
  prefecture: string;
  prefectureJa: string;
  region: string | null;
  elevationM: number;
  bestSeason: string | null;
  notes: string | null;
  alsoIn: string | null;
  // Approximate to roughly a kilometre; see db/coordinates.json. Nullable
  // because the schema allows a mountain to be added without a position.
  latitude: number | null;
  longitude: number | null;
};

export type Person = { id: number; name: string };

export type Ascent = {
  personId: number;
  mountainId: number;
  climbed: boolean;
  dateClimbed: string | null;
};

export type Entry = { climbed: boolean; dateClimbed: string | null };

export const key = (personId: number, mountainId: number) => `${personId}:${mountainId}`;

export function Checklist({
  mountains,
  people,
  ascents,
}: {
  mountains: Mountain[];
  people: Person[];
  ascents: Ascent[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      ascents.map((a) => [key(a.personId, a.mountainId), { climbed: a.climbed, dateClimbed: a.dateClimbed }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const out = new Map<number, number>(people.map((p) => [p.id, 0]));
    for (const person of people) {
      let n = 0;
      for (const m of mountains) if (entries[key(person.id, m.id)]?.climbed) n++;
      out.set(person.id, n);
    }
    return out;
  }, [entries, people, mountains]);

  // Optimistic: paint the change, then persist. Roll back on failure so the UI
  // never claims a summit the database rejected.
  function save(personId: number, mountainId: number, next: Entry) {
    const k = key(personId, mountainId);
    const previous = entries[k] ?? { climbed: false, dateClimbed: null };
    setEntries((current) => ({ ...current, [k]: next }));
    setError(null);

    setAscent(personId, mountainId, next.climbed, next.dateClimbed).catch(() => {
      setEntries((current) => ({ ...current, [k]: previous }));
      setError("Could not save that change. Check your connection and try again.");
    });
  }

  return (
    <main>
      <Banner
        people={people}
        counts={counts}
        total={mountains.length}
        onChanged={() => router.refresh()}
      />

      <div className="sheet">
        {error ? <p className="error banner-error">{error}</p> : null}

        {people.length === 0 ? (
          <p className="empty">No people yet — add someone below to start a column.</p>
        ) : null}

        <ChecklistTable mountains={mountains} people={people} entries={entries} onSave={save} />

        <AddPerson onAdded={() => router.refresh()} />

        <footer>
          Coordinates in the database are approximate (see <code>db/coordinates.json</code>). Add mountains with SQL
          against the <code>mountains</code> table.
          <p className="credit">
            Header print: Katsushika Hokusai, <i>Fine Wind, Clear Morning</i> (c. 1830) by day and{" "}
            <i>Shower Below the Summit</i> (c. 1830) after dark, from <i>Thirty-six Views of Mount Fuji</i>. Public
            domain, via Wikimedia Commons.
          </p>
        </footer>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Verify nothing changed**

Run: `npm run typecheck && npm test`
Expected: no type errors; 13 tests pass.

Then `npm run dev`, open `http://localhost:3000`, log in, and confirm: the banner print renders, tallies show the right counts, the theme toggle works, ticking a checkbox persists across a reload, the date field appears when ticked, and Edit/Delete on a person still work.

- [ ] **Step 7: Commit**

```bash
git add app/checklist.tsx app/banner.tsx app/checklist-table.tsx app/add-person.tsx
git commit -m "$(cat <<'EOF'
Split the checklist into banner, table and container

Pure extraction, no behaviour change. The container keeps the shared entry
state and the optimistic save so the map can reuse both.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The tab strip

**Files:**
- Modify: `app/checklist.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add the view state and tab strip**

In `app/checklist.tsx`, add to the imports:

```tsx
import { useMemo, useState } from "react";
```

(already there — no change needed). Add the state below `const [error, setError] = useState...`:

```tsx
  const [view, setView] = useState<"table" | "map">("table");
```

Then inside `<div className="sheet">`, immediately after the `error` and `people.length === 0` paragraphs, add the strip and switch the table behind it:

```tsx
        <div className="view-tabs" role="tablist" aria-label="Checklist view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "table"}
            className={view === "table" ? "on" : undefined}
            onClick={() => setView("table")}
          >
            一覧 <span>Table</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "map"}
            className={view === "map" ? "on" : undefined}
            onClick={() => setView("map")}
          >
            地図 <span>Map</span>
          </button>
        </div>

        {view === "table" ? (
          <ChecklistTable mountains={mountains} people={people} entries={entries} onSave={save} />
        ) : (
          <p className="empty">Map coming in the next task.</p>
        )}
```

- [ ] **Step 2: Style the tab strip**

Append to `app/globals.css`:

```css
/* ---- Map ------------------------------------------------------------- */

/* Tabs sit on the sheet like the paper tabs of an album. The hairline runs the
   full width of the strip and the view below is pulled up onto it: the table's
   opaque sticky header covers it, the map leaves it showing as the top rule of
   the map area. Both read correctly, so neither is special-cased. */
.view-tabs {
  display: flex;
  gap: 0;
  margin: 0 0 -1px;
  border-bottom: 1px solid var(--sumi);
}

.view-tabs button {
  font-family: var(--font-ja);
  font-size: 15px;
  letter-spacing: 0.06em;
  padding: 6px 18px;
  color: var(--sumi-faint);
  background: var(--washi-deep);
  border: 1px solid var(--rule);
  border-bottom: none;
  cursor: pointer;
}

.view-tabs button span {
  font-family: var(--font-en);
  font-size: 12px;
  font-style: italic;
}

.view-tabs button.on {
  color: var(--sumi);
  background: var(--washi);
  border-color: var(--sumi);
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors.

Then `npm run dev` and confirm the two tabs render, the active one is highlighted, and clicking 地図 swaps the table for the placeholder text without a page reload.

- [ ] **Step 4: Commit**

```bash
git add app/checklist.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Add a table/map tab strip to the checklist sheet

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: The pan and zoom hook

`scale` is 1 when the whole country fits and rises to 16 at maximum zoom. The viewBox always keeps the map's own aspect ratio, so the SVG element is given a matching `aspect-ratio` in CSS and `unitsPerPixel` is a single number.

**Files:**
- Create: `app/map/use-pan-zoom.ts`

- [ ] **Step 1: Write the hook**

Create `app/map/use-pan-zoom.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";

export const MIN_SCALE = 1;

// Roughly one prefecture filling the view. The stored coordinates are good to
// about a kilometre, which is ~4px here against a 14px triangle: the error
// stays visibly inside the symbol. Zooming further would imply a precision the
// data does not have. See the design spec.
export const MAX_SCALE = 16;

// Above this the map has room to name peaks as well as number them.
export const NAME_SCALE = 6;

// A few pixels of travel is a shaky tap, not a drag. Above this the gesture
// was a pan and any click it synthesises should be ignored.
const DRAG_SLOP = 5;

type Camera = { scale: number; cx: number; cy: number };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

function clampCamera({ scale, cx, cy }: Camera): Camera {
  const next = clamp(scale, MIN_SCALE, MAX_SCALE);
  const w = WIDTH / next;
  const h = HEIGHT / next;
  // Keep the country in view: the centre cannot wander past half a viewport
  // from either edge, so there is no way to pan into empty space.
  return {
    scale: next,
    cx: clamp(cx, w / 2, WIDTH - w / 2),
    cy: clamp(cy, h / 2, HEIGHT - h / 2),
  };
}

const FIT: Camera = { scale: MIN_SCALE, cx: WIDTH / 2, cy: HEIGHT / 2 };

export function usePanZoom(element: SVGSVGElement | null) {
  const [camera, setCamera] = useState<Camera>(FIT);
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState(false);

  // Pointers currently down, by pointerId, in client coordinates. A ref rather
  // than state: these change on every move and must not drive a render.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ gap: number; scale: number } | null>(null);

  // A drag that ends over a peak must not open it. The browser synthesises a
  // click on whatever was pressed regardless of pointer capture, so markers
  // ask this before acting.
  const travelled = useRef(0);
  const dragged = useRef(false);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      setMeasured(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const viewWidth = WIDTH / camera.scale;
  const viewHeight = HEIGHT / camera.scale;
  const minX = camera.cx - viewWidth / 2;
  const minY = camera.cy - viewHeight / 2;

  // How many map units one CSS pixel covers. Clustering and marker sizing both
  // key off this, which is what makes them zoom-independent. Before the first
  // ResizeObserver callback this is a placeholder guess, not a measurement —
  // no consumer should render markers against it. Check `measured` instead.
  const unitsPerPixel = width > 0 ? viewWidth / width : WIDTH / 600;

  const viewBox = `${minX} ${minY} ${viewWidth} ${viewHeight}`;

  /** Client coordinates to map units. */
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      if (!element) return { x: camera.cx, y: camera.cy };
      const box = element.getBoundingClientRect();
      return {
        x: minX + ((clientX - box.left) / box.width) * viewWidth,
        y: minY + ((clientY - box.top) / box.height) * viewHeight,
      };
    },
    [element, camera.cx, camera.cy, minX, minY, viewWidth, viewHeight],
  );

  /** Zoom by a factor while holding one map point under the same pixel. */
  const zoomAround = useCallback((factor: number, anchor: { x: number; y: number }) => {
    setCamera((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const actual = scale / current.scale;
      return clampCamera({
        scale,
        cx: anchor.x + (current.cx - anchor.x) / actual,
        cy: anchor.y + (current.cy - anchor.y) / actual,
      });
    });
  }, []);

  /** Zoom to an absolute scale while holding one map point under the same
      pixel. Pinch computes an absolute target from a fixed reference, so
      converting it to a relative factor outside the updater would read a
      possibly-stale scale — this keeps the whole calculation inside it. */
  const zoomTo = useCallback((scale: number, anchor: { x: number; y: number }) => {
    setCamera((current) => {
      const next = clamp(scale, MIN_SCALE, MAX_SCALE);
      const actual = next / current.scale;
      return clampCamera({
        scale: next,
        cx: anchor.x + (current.cx - anchor.x) / actual,
        cy: anchor.y + (current.cy - anchor.y) / actual,
      });
    });
  }, []);

  /** Zoom by a factor about the centre — for the on-screen buttons. */
  const zoomBy = useCallback((factor: number) => {
    setCamera((current) => clampCamera({ ...current, scale: current.scale * factor }));
  }, []);

  const fit = useCallback(() => setCamera(FIT), []);

  /** Frame a rectangle of map units with a margin — for zoom-to-cluster. */
  const fitBounds = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const padding = 1.6;
    const scale = Math.min(
      WIDTH / Math.max(x1 - x0, 1e-6) / padding,
      HEIGHT / Math.max(y1 - y0, 1e-6) / padding,
    );
    setCamera(clampCamera({ scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }));
  }, []);

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinchStart.current = null;
    travelled.current = 0;
    dragged.current = false;
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);

    // Any pointer movement counts toward the drag threshold, whether it turned
    // out to be a one-finger pan or a two-finger pinch: either way the gesture
    // was not a tap, and the click it synthesises should be ignored.
    travelled.current += Math.hypot(next.x - previous.x, next.y - previous.y);

    const touches = [...pointers.current.values()];

    if (touches.length >= 2) {
      const [a, b] = touches;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinchStart.current) {
        pinchStart.current = { gap, scale: camera.scale };
        return;
      }
      const target = clamp(
        (pinchStart.current.scale * gap) / pinchStart.current.gap,
        MIN_SCALE,
        MAX_SCALE,
      );
      const midpoint = toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomTo(target, midpoint);
      return;
    }

    // Single pointer: drag the paper. Moving the pointer right moves the map
    // right, so the camera goes left.
    const box = event.currentTarget.getBoundingClientRect();
    const dx = ((next.x - previous.x) / box.width) * viewWidth;
    const dy = ((next.y - previous.y) / box.height) * viewHeight;
    setCamera((current) => clampCamera({ ...current, cx: current.cx - dx, cy: current.cy - dy }));
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    // pointerup fires before the browser's synthesised click, so by the time
    // a marker's click handler runs, this is already settled.
    if (travelled.current > DRAG_SLOP) dragged.current = true;
  }

  // Wheel is bound natively rather than through React's onWheel: React attaches
  // wheel listeners passively, and a passive listener cannot preventDefault, so
  // the page would scroll behind the map as you zoomed.
  useEffect(() => {
    if (!element) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      zoomAround(Math.exp(-event.deltaY / 400), toMap(event.clientX, event.clientY));
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, [element, zoomAround, toMap]);

  return {
    scale: camera.scale,
    viewBox,
    unitsPerPixel,
    measured,
    wasDragged: () => dragged.current,
    zoomBy,
    fit,
    fitBounds,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors. A `TS2307` here means the import dropped the `.mjs` extension — see the import rule in the background notes.

- [ ] **Step 3: Commit**

```bash
git add app/map/use-pan-zoom.ts
git commit -m "$(cat <<'EOF'
Add the map pan and zoom hook

Wheel, drag and pinch onto a clamped viewBox. Zoom stops at 16x, about one
prefecture, so the map never implies more precision than the coordinates have.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: The map surface

**Files:**
- Create: `app/map/map-view.tsx`
- Modify: `app/checklist.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the map surface with the coastline only**

Create `app/map/map-view.tsx`:

```tsx
"use client";

import { type CSSProperties, useState } from "react";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";
import type { Entry, Mountain, Person } from "../checklist";
import { usePanZoom } from "./use-pan-zoom";

export function MapView({
  mountains,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
}) {
  // Callback ref in state rather than useRef: the pan/zoom hook needs to
  // re-run its effects once the element exists, and a ref mutation does not
  // trigger that.
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const { viewBox, handlers } = usePanZoom(element);

  const placed = mountains.filter((m) => m.latitude !== null && m.longitude !== null);
  const missing = mountains.length - placed.length;

  return (
    <div className="map">
      <svg
        ref={setElement}
        className="map-surface"
        viewBox={viewBox}
        // The CSS needs the projection's dimensions for its aspect ratio and
        // width cap; passing them in keeps projection.mjs the only place they
        // are written down. Same pattern as --tilt in checklist-table.tsx.
        style={{ "--map-w": WIDTH, "--map-h": HEIGHT } as CSSProperties}
        {...handlers}
        aria-label="Map of Japan showing the hundred famous mountains"
      >
        <g className="map-prefectures">
          {prefectures.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g className="map-coastline">
          {coastline.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>

      <p className="map-note">
        Summit positions are approximate — good to about a kilometre.
        {source === "placeholder" ? " The coastline is a schematic placeholder." : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Render it from the container**

In `app/checklist.tsx`, add the import:

```tsx
import { MapView } from "./map/map-view";
```

and replace the placeholder paragraph from Task 6:

```tsx
        ) : (
          <MapView mountains={mountains} people={people} entries={entries} onSave={save} />
        )}
```

- [ ] **Step 3: Style the surface**

Append to `app/globals.css`, below the `.view-tabs` rules:

```css
.map {
  padding-top: 14px;
}

/* The aspect ratio matches the projection's own, so one CSS pixel is always
   the same number of map units — which is what the pan/zoom hook's
   unitsPerPixel, and therefore clustering and marker sizing, assume.
   The height is bounded by capping the *width*: clamping height instead would
   leave the box wider than the ratio, and the SVG would letterbox inside it
   while contentRect.width still reported the full box — on a 900x900 window
   that read unitsPerPixel 44% low. The dimensions come in as custom
   properties so projection.mjs stays the only place they are written down. */
.map-surface {
  display: block;
  width: 100%;
  max-width: calc(78vh * var(--map-w) / var(--map-h));
  aspect-ratio: var(--map-w) / var(--map-h);
  margin: 0 auto;
  background: var(--washi);
  border: 1px solid var(--rule);
  touch-action: none; /* we handle pinch and drag ourselves */
  cursor: grab;
}

.map-surface:active {
  cursor: grabbing;
}

.map-coastline path {
  fill: none;
  stroke: var(--sumi);
  stroke-width: 1.4;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.map-prefectures path {
  fill: none;
  stroke: var(--rule);
  stroke-width: 0.8;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}

.map-note {
  font-family: var(--font-en);
  font-size: 12px;
  font-style: italic;
  color: var(--sumi-faint);
  text-align: center;
  margin: 8px 0 0;
}
```

`vector-effect: non-scaling-stroke` keeps hairlines one pixel wide at every zoom — without it the coastline thickens into a slab as you zoom in.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

Then `npm run dev`, open the 地図 tab, and confirm: a recognisable outline of Japan in sumi hairline on washi; dragging pans; the wheel zooms without scrolling the page behind it; the outline cannot be dragged off screen; the approximate-positions note sits underneath. Switch to dark mode and confirm the coastline inverts with the palette.

- [ ] **Step 5: Commit**

```bash
git add app/map/map-view.tsx app/checklist.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Draw the map surface with the coastline

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Peaks and clusters

Markers are drawn in **pixel units** and placed with a `translate(x, y) scale(unitsPerPixel)` transform, so a triangle is the same size on screen at every zoom.

**Files:**
- Create: `app/map/peak-marker.tsx`
- Create: `app/map/cluster-marker.tsx`
- Modify: `app/map/map-view.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the peak marker**

Create `app/map/peak-marker.tsx`:

```tsx
"use client";

import { useId } from "react";

// Marker dimensions in screen pixels. The parent applies a counter-scale so
// these stay constant however far you zoom.
export const HALF_WIDTH = 7;
export const PEAK_HEIGHT = 11;

/** The triangle, apex up, sitting on its base at y = 0. */
export const PEAK_PATH = `M0 ${-PEAK_HEIGHT}L${HALF_WIDTH} 0L${-HALF_WIDTH} 0Z`;

export function PeakMarker({
  fill,
  label,
  onActivate,
  selected,
}: {
  /** 0 to 1 — how many of the selected people have climbed it. */
  fill: number;
  label: string;
  onActivate: () => void;
  selected: boolean;
}) {
  const clipId = useId();

  return (
    <g
      className={`peak${selected ? " on" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {/* A generous invisible target: the triangle itself is too small to hit
          reliably on a phone. */}
      <circle className="peak-target" cx={0} cy={-PEAK_HEIGHT / 2} r={HALF_WIDTH + 5} />

      {fill > 0 ? (
        <>
          <clipPath id={clipId}>
            <path d={PEAK_PATH} />
          </clipPath>
          {/* Ink rises from the base like a water level. Proportional to height
              rather than area: at 11px, area-proportional fill puts the halfway
              mark uncomfortably low and reads as less than half. */}
          <rect
            className="peak-ink"
            x={-HALF_WIDTH}
            y={-PEAK_HEIGHT * fill}
            width={HALF_WIDTH * 2}
            height={PEAK_HEIGHT * fill}
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : null}

      <path className="peak-outline" d={PEAK_PATH} />
    </g>
  );
}
```

- [ ] **Step 2: Write the cluster marker**

Create `app/map/cluster-marker.tsx`:

```tsx
"use client";

import { useId } from "react";

// A ridge: two overlapping peaks, larger than a lone one. Deliberately not a
// single big triangle — that reads as one big mountain until you find the
// number beside it.
const BACK = "M-4 -17L9 0L-17 0Z";
const FRONT = "M10 -11L21 0L-1 0Z";
const RIDGE_HEIGHT = 17;
const RIDGE_LEFT = -17;
const RIDGE_RIGHT = 21;

export function ClusterMarker({
  count,
  fill,
  label,
  onActivate,
}: {
  count: number;
  /** 0 to 1 — how many of its peaks everyone selected has climbed. */
  fill: number;
  label: string;
  onActivate: () => void;
}) {
  const clipId = useId();

  return (
    <g
      className="cluster"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <rect
        className="peak-target"
        x={RIDGE_LEFT - 4}
        y={-RIDGE_HEIGHT - 4}
        width={RIDGE_RIGHT - RIDGE_LEFT + 8}
        height={RIDGE_HEIGHT + 8}
      />

      {fill > 0 ? (
        <>
          <clipPath id={clipId}>
            <path d={BACK} />
            <path d={FRONT} />
          </clipPath>
          <rect
            className="peak-ink"
            x={RIDGE_LEFT}
            y={-RIDGE_HEIGHT * fill}
            width={RIDGE_RIGHT - RIDGE_LEFT}
            height={RIDGE_HEIGHT * fill}
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : null}

      <path className="peak-outline" d={BACK} />
      <path className="peak-outline" d={FRONT} />
      <text className="cluster-count" x={RIDGE_RIGHT + 3} y={-1}>
        {count}
      </text>
    </g>
  );
}
```

- [ ] **Step 3: Project, cluster and render**

Rewrite `app/map/map-view.tsx`:

```tsx
"use client";

import { type CSSProperties, useMemo, useState } from "react";
import { cluster } from "@/lib/map/cluster.mjs";
import { coastline, prefectures, source } from "@/lib/map/japan-geometry";
import { HEIGHT, WIDTH, project } from "@/lib/map/projection.mjs";
import { type Entry, type Mountain, type Person, key } from "../checklist";
import { ClusterMarker } from "./cluster-marker";
import { PeakMarker } from "./peak-marker";
import { usePanZoom } from "./use-pan-zoom";

// Screen pixels below which two peaks merge into a ridge. A triangle is 14px
// wide, so this leaves a clear gap between neighbours.
const MIN_SEPARATION_PX = 22;

type PlacedPeak = {
  order: number;
  x: number;
  y: number;
  mountain: Mountain;
};

export function MapView({
  mountains,
  people,
  entries,
  selectedIds,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  selectedIds: number[];
}) {
  const [element, setElement] = useState<SVGSVGElement | null>(null);
  const { viewBox, unitsPerPixel, measured, handlers } = usePanZoom(element);

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

  const nameOf = (m: Mountain) => `${m.nameEn} (${m.nameKanji})`;

  return (
    <div className="map">
      <svg
        ref={setElement}
        className="map-surface"
        viewBox={viewBox}
        // The CSS needs the projection's dimensions for its aspect ratio and
        // width cap; passing them in keeps projection.mjs the only place they
        // are written down. Same pattern as --tilt in checklist-table.tsx.
        style={{ "--map-w": WIDTH, "--map-h": HEIGHT } as CSSProperties}
        {...handlers}
        aria-label="Map of Japan showing the hundred famous mountains"
      >
        <g className="map-prefectures">
          {prefectures.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g className="map-coastline">
          {coastline.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* Markers wait for the first ResizeObserver measurement. Until then
            unitsPerPixel is a placeholder, and clustering keyed off a wrong
            value would paint the wrong groupings and then reflow. */}
        <g className="map-markers">
          {measured && clusters.map((c) => {
            // Markers are drawn in pixel units; the counter-scale keeps them
            // the same size on screen however far the map is zoomed.
            const transform = `translate(${c.x} ${c.y}) scale(${unitsPerPixel})`;

            if (c.members.length === 1) {
              const peak = c.members[0];
              const fill = fillFor(peak.mountain);
              return (
                <g key={`m${peak.mountain.id}`} transform={transform}>
                  <PeakMarker
                    fill={fill}
                    selected={false}
                    label={`${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`}
                    onActivate={() => {}}
                  />
                </g>
              );
            }

            const done = c.members.filter((m) => fillFor(m.mountain) === 1).length;
            return (
              <g key={`c${c.members[0].mountain.id}`} transform={transform}>
                <ClusterMarker
                  count={c.members.length}
                  fill={done / c.members.length}
                  label={`${c.members.length} peaks, ${done} climbed by everyone selected. Zoom in.`}
                  onActivate={() => {}}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <p className="map-note">
        Summit positions are approximate — good to about a kilometre.
        {source === "placeholder" ? " The coastline is a schematic placeholder." : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}
      </p>
    </div>
  );
}
```

`people` is accepted but not yet read — it is used by the person filter in Task 10. Keep it in the props so the container's call site does not churn twice.

- [ ] **Step 4: Update the call site**

In `app/checklist.tsx`, the map branch becomes — selection arrives properly in Task 10, so for now select everyone:

```tsx
        ) : (
          <MapView
            mountains={mountains}
            people={people}
            entries={entries}
            selectedIds={people.map((p) => p.id)}
          />
        )}
```

- [ ] **Step 5: Style the markers**

Append to `app/globals.css`:

```css
.peak-outline {
  fill: none;
  stroke: var(--sumi);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

/* Vermilion, the same ink as the seal pressed in the table: a filled triangle
   and a stamped checkbox mean the same thing. */
.peak-ink {
  fill: var(--beni);
}

.peak-target {
  fill: transparent;
}

.peak,
.cluster {
  cursor: pointer;
}

.peak:focus-visible .peak-outline,
.cluster:focus-visible .peak-outline {
  stroke: var(--bero-ai);
  stroke-width: 2.5;
}

.peak:focus,
.cluster:focus {
  outline: none; /* replaced by the stroke above, which follows the triangle */
}

.cluster-count {
  font-family: var(--font-en);
  font-size: 12px;
  fill: var(--sumi);
  dominant-baseline: alphabetic;
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: no errors; 14 tests pass.

Then `npm run dev` and on the 地図 tab confirm: triangles appear over the outline in plausible places (Fuji south-west of Tokyo, a dense knot in the Japan Alps, a scatter across Hokkaido); climbed peaks are filled vermilion; zoomed out, the Alps show as ridges with counts; zooming in splits them into individual triangles; triangles stay the same size on screen as you zoom; the counts across all ridges plus the lone triangles add up to 100.

- [ ] **Step 7: Commit**

```bash
git add app/map/peak-marker.tsx app/map/cluster-marker.tsx app/map/map-view.tsx app/checklist.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Draw peaks as triangles and crowded peaks as ridges

Markers are drawn in pixel units under a counter-scale, so they hold their
size at every zoom, and the ink rises from the base in proportion to how
many of the selected people have climbed the peak.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: The person filter

**Files:**
- Create: `app/map/person-filter.tsx`
- Modify: `app/checklist.tsx`
- Modify: `app/map/map-view.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the filter**

Create `app/map/person-filter.tsx`:

```tsx
"use client";

import type { Person } from "../checklist";

/**
 * Restates the fill rule in words so the map is never ambiguous about what is
 * being shown. Phrasing follows the size of the selection.
 */
function summary(selected: Person[], fullyClimbed: number, total: number) {
  if (selected.length === 0) return "Nobody selected — tick someone to ink the map";
  if (selected.length === 1) return `${fullyClimbed} of ${total} climbed by ${selected[0].name}`;
  if (selected.length === 2) return `${fullyClimbed} of ${total} climbed by both`;
  return `${fullyClimbed} of ${total} climbed by all ${selected.length}`;
}

export function PersonFilter({
  people,
  selectedIds,
  onToggle,
  fullyClimbed,
  total,
}: {
  people: Person[];
  selectedIds: number[];
  onToggle: (personId: number) => void;
  fullyClimbed: number;
  total: number;
}) {
  const selected = people.filter((p) => selectedIds.includes(p.id));

  return (
    <div className="map-filter">
      <span className="map-filter-label">Showing</span>
      {people.map((person) => {
        const on = selectedIds.includes(person.id);
        return (
          <button
            key={person.id}
            type="button"
            className={`chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onToggle(person.id)}
          >
            {person.name}
          </button>
        );
      })}
      <span className="map-filter-summary">{summary(selected, fullyClimbed, total)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Own the selection in the container**

In `app/checklist.tsx`, add the state beside `view`:

```tsx
  // Everyone is shown by default, so a solid triangle means "all of us".
  const [selectedIds, setSelectedIds] = useState<number[]>(() => people.map((p) => p.id));
```

and pass it down, replacing the Task 9 call site:

```tsx
        ) : (
          <MapView
            mountains={mountains}
            people={people}
            entries={entries}
            selectedIds={selectedIds}
            onTogglePerson={(personId) =>
              setSelectedIds((current) =>
                current.includes(personId)
                  ? current.filter((id) => id !== personId)
                  : [...current, personId],
              )
            }
            onSave={save}
          />
        )}
```

- [ ] **Step 3: Render the filter from the map**

In `app/map/map-view.tsx`, add the import:

```tsx
import { PersonFilter } from "./person-filter";
```

Extend the props:

```tsx
export function MapView({
  mountains,
  people,
  entries,
  selectedIds,
  onTogglePerson,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  selectedIds: number[];
  onTogglePerson: (personId: number) => void;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
}) {
```

Add the count above the `return`, after `clusters`:

```tsx
  const fullyClimbed =
    selectedIds.length === 0 ? 0 : placed.filter((p) => fillFor(p.mountain) === 1).length;
```

and render the filter as the first child of `<div className="map">`:

```tsx
      <PersonFilter
        people={people}
        selectedIds={selectedIds}
        onToggle={onTogglePerson}
        fullyClimbed={fullyClimbed}
        total={placed.length}
      />
```

- [ ] **Step 4: Style the chips**

Append to `app/globals.css`:

```css
.map-filter {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 10px;
}

.map-filter-label {
  font-family: var(--font-en);
  font-size: 11px;
  font-style: italic;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sumi-faint);
}

.map-filter-summary {
  margin-left: auto;
  font-family: var(--font-en);
  font-size: 12px;
  font-style: italic;
  color: var(--sumi-faint);
}

.chip {
  font-family: var(--font-en);
  font-size: 13px;
  padding: 2px 12px;
  border: 1px solid var(--beni);
  border-radius: 11px;
  background: transparent;
  color: var(--beni);
  cursor: pointer;
}

.chip.on {
  background: var(--beni);
  color: var(--washi);
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: no errors.

Then `npm run dev` and confirm on the 地図 tab: all chips start on; unticking everyone empties every triangle and the summary reads "Nobody selected"; one person gives plain filled/hollow triangles and "N of 100 climbed by <name>"; two gives half-filled triangles and "…by both"; three gives thirds and "…by all 3". Check a peak you know only one person has climbed shows as partly filled with two selected.

- [ ] **Step 6: Commit**

```bash
git add app/map/person-filter.tsx app/map/map-view.tsx app/checklist.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Add person chips to the map

One rule and no modes: ink level is how many of the ticked people have
climbed a peak, over how many are ticked. The summary line restates that in
words so the map cannot be misread.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: The peak card

**Files:**
- Create: `app/map/peak-card.tsx`
- Modify: `app/map/map-view.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the card**

Create `app/map/peak-card.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { type Entry, type Mountain, type Person, key } from "../checklist";

export function PeakCard({
  mountain,
  people,
  entries,
  onSave,
  onClose,
  style,
}: {
  mountain: Mountain;
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
  onClose: () => void;
  style: React.CSSProperties;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: PointerEvent) => {
      if (!card.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Capture phase: the map swallows pointer events for panning, so a
    // bubbling listener would never see a click that landed on the map.
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const notes = [mountain.region, mountain.notes, mountain.alsoIn && `also ${mountain.alsoIn}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="peak-card" ref={card} style={style} role="dialog" aria-label={mountain.nameEn}>
      <button type="button" className="peak-card-close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <span className="kanji">{mountain.nameKanji}</span>
      <span className="kana">{mountain.nameKana}</span>
      <span className="en">{mountain.nameEn}</span>

      <p className="peak-card-meta">
        {mountain.elevationM.toLocaleString("en-US")} m · {mountain.prefectureJa}
        {mountain.bestSeason ? ` · ${mountain.bestSeason}` : null}
      </p>
      {notes ? <p className="peak-card-notes">{notes}</p> : null}

      <ul className="peak-card-people">
        {people.map((person) => {
          const entry = entries[key(person.id, mountain.id)];
          const climbed = entry?.climbed ?? false;
          return (
            <li key={person.id}>
              <label>
                <input
                  type="checkbox"
                  checked={climbed}
                  onChange={(event) =>
                    onSave(person.id, mountain.id, {
                      climbed: event.target.checked,
                      // Unchecking discards the date, as in the table: the row
                      // means "not climbed", so a date would contradict it.
                      dateClimbed: event.target.checked ? (entry?.dateClimbed ?? null) : null,
                    })
                  }
                />
                {person.name}
              </label>
              {climbed ? (
                <input
                  type="date"
                  className="date"
                  value={entry?.dateClimbed ?? ""}
                  aria-label={`Date ${person.name} climbed ${mountain.nameEn}`}
                  onChange={(event) =>
                    onSave(person.id, mountain.id, {
                      climbed: true,
                      dateClimbed: event.target.value || null,
                    })
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Open it from the map**

In `app/map/map-view.tsx`:

Add the import:

```tsx
import { PeakCard } from "./peak-card";
```

Add `onSave` to the destructured props (the type already lists it), and add state below `element`:

```tsx
  const [openId, setOpenId] = useState<number | null>(null);
```

Replace the peak marker's `onActivate={() => {}}` with `onActivate={() => setOpenId(peak.mountain.id)}`, and its `selected={false}` with `selected={openId === peak.mountain.id}`.

**Guard the click path against drags.** A pan that happens to end over a peak still makes the browser synthesise a click on it, which would open a card the user never asked for. Take `wasDragged` from the hook:

```tsx
  const { viewBox, unitsPerPixel, measured, wasDragged, handlers } = usePanZoom(element);
```

and put a single capture-phase guard on the marker group, rather than threading `wasDragged` into every marker:

```tsx
        <g
          className="map-markers"
          onClickCapture={(event) => {
            // A pan that ends over a peak still synthesises a click on it.
            // Capture phase runs before the marker's own handler, so stopping
            // here suppresses it. Deliberately only on the click path: every
            // real click is preceded by a pointerdown that resets the flag,
            // whereas keyboard activation never touches it and must not be
            // suppressed by a stale drag.
            if (wasDragged()) event.stopPropagation();
          }}
        >
```

The card is an HTML overlay, so it needs the peak's position as a percentage of the container rather than in map units. The hook gives `viewBox` as a string; parse it once above the `return`. Extend the projection import to bring in the map's own dimensions — deriving the aspect ratio from them rather than retyping `1120.3` keeps this in step with the extent:

```tsx
import { HEIGHT, WIDTH, project } from "@/lib/map/projection.mjs";
```

```tsx
  const [vbX, vbY, vbW] = viewBox.split(" ").map(Number);
  const open = placed.find((p) => p.mountain.id === openId) ?? null;

  // A peak more than about three-fifths of the way across would push a
  // right-hand card off the edge, so it flips to the left instead.
  const cardStyle: React.CSSProperties | null = open
    ? (() => {
        const leftPercent = ((open.x - vbX) / vbW) * 100;
        const topPercent = ((open.y - vbY) / (vbW * (HEIGHT / WIDTH))) * 100;
        return leftPercent > 62
          ? { right: `${100 - leftPercent}%`, top: `${topPercent}%`, marginRight: "14px" }
          : { left: `${leftPercent}%`, top: `${topPercent}%`, marginLeft: "14px" };
      })()
    : null;
```

Now wrap the map in a positioned frame so the card can be placed over it. **Do not retype the `<svg>`** — leave its attributes and all three `<g>` children exactly as Task 9 left them. Make three edits:

1. Immediately before the existing `<svg`, insert `<div className="map-frame">`.
2. Immediately after the existing `</svg>`, insert the card and the frame's closing tag:

```tsx
        {open && cardStyle ? (
          <PeakCard
            mountain={open.mountain}
            people={people}
            entries={entries}
            onSave={onSave}
            onClose={() => setOpenId(null)}
            style={cardStyle}
          />
        ) : null}
      </div>
```

3. Re-indent the `<svg>` block one level to sit inside the new `<div>`.

Close the card whenever the clustering changes, so a peak that has just been swallowed by a ridge does not leave a card pointing at nothing. Add below the `clusters` memo:

```tsx
  useEffect(() => {
    if (openId === null) return;
    const stillAlone = clusters.some(
      (c) => c.members.length === 1 && c.members[0].mountain.id === openId,
    );
    if (!stillAlone) setOpenId(null);
  }, [clusters, openId]);
```

and add `useEffect` to the React import.

- [ ] **Step 3: Style the card**

Append to `app/globals.css`:

```css
.map-frame {
  position: relative;
}

.peak-card {
  position: absolute;
  z-index: 2;
  width: 210px;
  padding: 9px 12px 10px;
  background: var(--washi);
  border: 1px solid var(--sumi);
  box-shadow: 3px 3px 0 rgb(27 23 19 / 0.12);
  font-family: var(--font-en);
  font-size: 13px;
}

.peak-card .kanji {
  display: block;
  font-family: var(--font-ja);
  font-size: 19px;
  line-height: 1.2;
}

.peak-card .kana {
  display: block;
  font-family: var(--font-ja);
  font-size: 11px;
  color: var(--sumi-faint);
}

.peak-card .en {
  display: block;
  font-style: italic;
  color: var(--sumi-soft);
}

.peak-card-meta {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--sumi-faint);
  border-top: 1px solid var(--rule);
  padding-top: 5px;
}

.peak-card-notes {
  margin: 2px 0 0;
  font-size: 11px;
  font-style: italic;
  color: var(--sumi-faint);
}

.peak-card-people {
  list-style: none;
  margin: 7px 0 0;
  padding: 0;
  border-top: 1px solid var(--rule);
  padding-top: 6px;
}

.peak-card-people li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 1px 0;
}

.peak-card-people label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.peak-card-close {
  position: absolute;
  top: 2px;
  right: 5px;
  border: none;
  background: none;
  font-size: 17px;
  line-height: 1;
  color: var(--sumi-faint);
  cursor: pointer;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

Then `npm run dev` and confirm: clicking a lone triangle opens a card with the right mountain; the card flips to the left of peaks near the right edge; ticking a person in the card fills the triangle immediately; switching to the 一覧 tab shows the same tick already applied to the table; reloading keeps it; `Escape` and an outside click both close the card; zooming out until the peak joins a ridge closes the card rather than stranding it.

- [ ] **Step 5: Commit**

```bash
git add app/map/peak-card.tsx app/map/map-view.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Open a peak card from the map and let climbs be ticked there

The card calls the container's existing optimistic save, so a tick made on
the map is already in the table when you flip tabs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Labels, zoom controls and zoom-to-ridge

**Files:**
- Modify: `app/map/peak-marker.tsx`
- Modify: `app/map/map-view.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add labels to the peak marker**

In `app/map/peak-marker.tsx`, add two props and render them. Extend the signature:

```tsx
export function PeakMarker({
  fill,
  label,
  number,
  name,
  onActivate,
  selected,
}: {
  fill: number;
  label: string;
  /** Fukada number, or null for an unnumbered addition. */
  number: number | null;
  /** English name, shown only when the map has room for it. */
  name: string | null;
  onActivate: () => void;
  selected: boolean;
}) {
```

and add after the `<path className="peak-outline" .../>`:

```tsx
      {/* Clustering guarantees at least 22px between markers, so labels placed
          beside the triangle cannot collide with a neighbour's. */}
      {number !== null ? (
        <text className="peak-number" x={HALF_WIDTH + 2} y={0}>
          {number}
        </text>
      ) : null}
      {name ? (
        <text className="peak-name" x={HALF_WIDTH + 2} y={9}>
          {name}
        </text>
      ) : null}
```

- [ ] **Step 2: Pass the labels and add the controls**

In `app/map/map-view.tsx`, take the extra values from the hook:

```tsx
  const { scale, viewBox, unitsPerPixel, measured, wasDragged, zoomBy, fit, fitBounds, handlers } =
    usePanZoom(element);
```

Import the threshold:

```tsx
import { NAME_SCALE, usePanZoom } from "./use-pan-zoom";
```

Pass the label props on the peak marker:

```tsx
                  <PeakMarker
                    fill={fill}
                    selected={openId === peak.mountain.id}
                    number={peak.mountain.fukadaNumber}
                    name={scale >= NAME_SCALE ? peak.mountain.nameEn : null}
                    label={`${nameOf(peak.mountain)}, ${peak.mountain.elevationM} metres`}
                    onActivate={() => setOpenId(peak.mountain.id)}
                  />
```

Give the ridge its zoom-to-fit behaviour, replacing `onActivate={() => {}}`:

```tsx
                  onActivate={() =>
                    fitBounds(
                      Math.min(...c.members.map((m) => m.x)),
                      Math.min(...c.members.map((m) => m.y)),
                      Math.max(...c.members.map((m) => m.x)),
                      Math.max(...c.members.map((m) => m.y)),
                    )
                  }
```

Add the controls inside `.map-frame`, after the `</svg>`:

```tsx
        <div className="map-zoom">
          <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="fit" onClick={fit} aria-label="Show the whole country">
            全図
          </button>
        </div>
```

- [ ] **Step 3: Style labels and controls**

Append to `app/globals.css`:

```css
.peak-number {
  font-family: var(--font-en);
  font-size: 9px;
  fill: var(--sumi-faint);
}

.peak-name {
  font-family: var(--font-en);
  font-size: 9px;
  font-style: italic;
  fill: var(--sumi-soft);
}

.map-zoom {
  position: absolute;
  top: 9px;
  right: 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.map-zoom button {
  width: 26px;
  height: 26px;
  font-family: var(--font-ja);
  font-size: 15px;
  line-height: 1;
  color: var(--sumi);
  background: var(--washi);
  border: 1px solid var(--sumi);
  cursor: pointer;
}

.map-zoom button.fit {
  font-size: 10px;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

Then `npm run dev` and confirm: Fukada numbers sit beside unclustered triangles and never overlap a neighbour's; English names appear only once zoomed well in; `+`, `−` and 全図 work; clicking a ridge zooms to frame exactly its peaks; zooming to the maximum stops rather than continuing indefinitely.

- [ ] **Step 5: Commit**

```bash
git add app/map/peak-marker.tsx app/map/map-view.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Label peaks and add zoom controls

Numbers appear once a peak leaves its cluster and names once there is room,
so clustering does double duty as label collision avoidance.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Accessibility and motion

**Files:**
- Modify: `app/checklist.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Tie the tabs to their panel**

In `app/checklist.tsx`, give each tab button an `id` and `aria-controls`, and wrap the view in a panel. Update the two buttons:

```tsx
          <button
            type="button"
            role="tab"
            id="tab-table"
            aria-controls="view-panel"
            aria-selected={view === "table"}
            className={view === "table" ? "on" : undefined}
            onClick={() => setView("table")}
          >
            一覧 <span>Table</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-map"
            aria-controls="view-panel"
            aria-selected={view === "map"}
            className={view === "map" ? "on" : undefined}
            onClick={() => setView("map")}
          >
            地図 <span>Map</span>
          </button>
```

and wrap the branch in a panel. The `<MapView>` props are unchanged from Task 10 and are repeated here in full so this block can be pasted whole:

```tsx
        <div id="view-panel" role="tabpanel" aria-labelledby={view === "table" ? "tab-table" : "tab-map"}>
          {view === "table" ? (
            <ChecklistTable mountains={mountains} people={people} entries={entries} onSave={save} />
          ) : (
            <MapView
              mountains={mountains}
              people={people}
              entries={entries}
              selectedIds={selectedIds}
              onTogglePerson={(personId) =>
                setSelectedIds((current) =>
                  current.includes(personId)
                    ? current.filter((id) => id !== personId)
                    : [...current, personId],
                )
              }
              onSave={save}
            />
          )}
        </div>
```

- [ ] **Step 2: Point people at the table**

The map puts up to 100 focusable triangles in the tab order. Anyone who would rather not tab through them has the table, which carries everything the map does. Make that explicit rather than implied — in `app/map/map-view.tsx`, extend the note:

```tsx
      <p className="map-note">
        Summit positions are approximate — good to about a kilometre.
        {source === "placeholder" ? " The coastline is a schematic placeholder." : null}
        {missing > 0 ? ` ${missing} of ${mountains.length} peaks have no coordinates yet.` : null}{" "}
        The 一覧 table lists every peak in full.
      </p>
```

- [ ] **Step 3: Respect reduced motion**

Append to `app/globals.css`:

```css
/* The map has no transitions of its own — panning and zooming are direct
   manipulation, which reduced-motion does not ask us to suppress — but the
   chips and controls do pick up the page's hover treatments. */
@media (prefers-reduced-motion: reduce) {
  .chip,
  .map-zoom button,
  .view-tabs button {
    transition: none;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

Then `npm run dev` and check with the keyboard alone: `Tab` reaches both tabs; `Enter` switches view; on the map, `Tab` moves between triangles and a focused triangle shows a blue outline following the triangle's shape; `Enter` or `Space` opens its card; `Escape` closes it; focus is visible at every step. Confirm colour is never the only signal — a half-filled triangle differs in shape, not just hue.

- [ ] **Step 5: Commit**

```bash
git add app/checklist.tsx app/map/map-view.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Wire up tab semantics and keyboard access for the map

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Documentation and a full pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the map**

In `README.md`, replace the existing "## Coordinates" section with:

```markdown
## Coordinates and the map

`latitude` / `longitude` are populated for all 100 peaks but are **approximate**
— recorded from general knowledge, not a surveyed source, and good to roughly a
kilometre. Fine for map pins; not for navigation. See `db/coordinates.json` for
per-peak provenance.

The 地図 tab draws them as triangles on a schematic outline of Japan, inked in
proportion to how many of the selected people have climbed each peak. Because
the coordinates are approximate, the map stops zooming at roughly one prefecture
— far enough in to separate neighbouring peaks, not so far that the error
becomes visible.

### Replacing the coastline

The outline is a placeholder: about 80 lat/lon control points traced from named
coastal landmarks, in `db/coastline.json`. It is stored as coordinates rather
than SVG so that it goes through the same projection as the summits, which is
what keeps the triangles registered to the coast.

To swap in real geometry, convert Natural Earth or GSI data into the same shape
— rings of `[lat, lon]` under `coastline` and `prefectures`, with `source` set
to `"natural-earth"` — and re-run:

```
npm run map:build
```

That rewrites `lib/map/japan-geometry.ts` and nothing else. No peak moves,
because both the outline and the summits are projected by
`lib/map/projection.mjs`. Prefecture borders are empty in the placeholder and
appear with the real geometry.

## Tests

```
npm test
```

Covers the two pure modules — the projection and the marker clustering — with
Node's built-in test runner. Components are verified by running the app.
```

- [ ] **Step 2: Full verification**

Run each and confirm:

```bash
npm test          # 13 tests, 0 failures
npm run typecheck # no errors
npm run build     # completes; this is what Vercel runs
```

- [ ] **Step 3: Check the tree is clean**

Run: `git status`
Expected: clean, or showing only `AGENTS.md`. Per `AGENTS.md`, `next dev` rewrites that block; if it has changed, commit it with the work rather than leaving it uncommitted.

- [ ] **Step 4: Manual acceptance pass**

With `npm run dev`, walk the whole feature once:

- Table tab renders as before; ticking and dating still persist.
- Map tab: Japan in sumi hairline; 100 peaks accounted for between lone triangles and ridge counts.
- All chips on → solid triangles mean everyone. Untick one → halves and thirds appear. Untick all → empty map, "Nobody selected".
- Drag, wheel, pinch (or trackpad), `+`, `−`, 全図 all behave; the country cannot be dragged away.
- Click a ridge → it frames its peaks. Click a peak → card opens with the right data.
- Tick from the card → triangle fills, table agrees, reload confirms it saved.
- Dark mode: paper, ink, vermilion and hairlines all invert; nothing becomes unreadable.
- Narrow the window to phone width: the map still fits and is usable.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Document the map and how to replace its placeholder coastline

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done

The branch now carries: a tested projection and clustering pair, a geometry generator with a placeholder coastline, a refactored checklist split into four focused files, and a zoomable map with person filtering, ridges, labels and editable peak cards — with no runtime dependency added.

Use `superpowers:finishing-a-development-branch` to decide how to integrate.
