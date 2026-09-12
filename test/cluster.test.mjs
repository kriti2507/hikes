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

test("a chain of points splits rather than snowballing into one cluster", () => {
  // Joining compares a new point against the cluster's running centroid, not
  // its nearest member. If it compared against the nearest member instead, a
  // line of evenly-spaced peaks would chain together one hop at a time and
  // collapse into a single marker spanning far more than minSeparation. The
  // centroid check catches that: once {0, 10} is centred at 5, the next point
  // at 20 is 15 away -- over the threshold -- so it starts a new cluster.
  const chain = [point(1, 0, 0), point(2, 10, 0), point(3, 20, 0), point(4, 30, 0)];
  const result = cluster(chain, 12);
  assert.equal(result.length, 2);
  assert.deepEqual(sizes(result), [2, 2]);
});
