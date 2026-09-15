// The fraction a folded prefecture heading shows. The rule is "everyone has
// it", which is vacuously true of an empty roster -- which is exactly why that
// case is pinned down here rather than left to the caller to remember.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countFullyClimbed } from "../lib/progress.mjs";

// climbed[personId] is the list of mountain ids that person has ticked.
const from = (climbed) => (personId, mountainId) =>
  (climbed[personId] ?? []).includes(mountainId);

test("counts a peak only once every person has it", () => {
  const isClimbed = from({ 1: [10, 11], 2: [10] });
  assert.equal(countFullyClimbed([10, 11, 12], [1, 2], isClimbed), 1);
});

test("counts every peak when everyone has climbed them all", () => {
  const isClimbed = from({ 1: [10, 11], 2: [10, 11] });
  assert.equal(countFullyClimbed([10, 11], [1, 2], isClimbed), 2);
});

test("counts nothing when nobody has climbed anything", () => {
  assert.equal(countFullyClimbed([10, 11], [1, 2], () => false), 0);
});

test("an empty roster counts nothing rather than everything", () => {
  assert.equal(countFullyClimbed([10, 11], [], () => true), 0);
});

test("an empty mountain list counts nothing", () => {
  assert.equal(countFullyClimbed([], [1], () => true), 0);
});
