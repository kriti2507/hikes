// Pure so it can be tested by `node --test` without a DOM, and `.mjs` for the
// same reason the map's modules are: the test runner imports it directly.

/** How many of `mountainIds` every one of `personIds` has climbed.
 *
 * Takes a predicate rather than the entries map so it never learns the
 * "personId:mountainId" key format and cannot drift from checklist.tsx's
 * `key()`.
 *
 * An empty roster returns 0, not `mountainIds.length`: "everyone has climbed
 * it" is vacuously true of nobody, and a checklist with no people on it has
 * not been swept. The caller suppresses the fraction in that case anyway, but
 * the honest answer belongs here rather than only at the call site.
 */
export function countFullyClimbed(mountainIds, personIds, isClimbed) {
  if (personIds.length === 0) return 0;

  let done = 0;
  for (const mountainId of mountainIds) {
    if (personIds.every((personId) => isClimbed(personId, mountainId))) done++;
  }
  return done;
}
