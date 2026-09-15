# Prefecture Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each prefecture heading in the 一覧 table fold its mountains away, with one button in the tab row that folds or unfolds all 28 at once.

**Architecture:** `app/checklist.tsx` owns a `collapsed: Set<string>` of prefecture names and passes `collapsed` + `onToggleGroup` into `ChecklistTable`, mirroring how it already threads `selectedIds` + `onTogglePerson` into `MapView`. `ChecklistTable` turns each group heading into a real `<button>` and skips rendering that group's rows when it is collapsed. A folded heading swaps its peak count for a progress fraction computed by a new pure module, `lib/progress.mjs`.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, TypeScript, plain CSS in `app/globals.css`, `node --test` for the pure module.

**Spec:** `docs/superpowers/specs/2026-09-15-prefecture-fold-design.md`

**Before you start — two facts about this repo that will bite you:**

1. **`app/globals.css:558` has a global `button` rule** that sets `padding: 0.42rem 1.2rem`, a 2px beni border, a beni background, white text and `letter-spacing: 0.08em`. Every new button in this plan must explicitly reset what it does not want. This rule has already broken two controls in this file's history.
2. **`npm run build` cannot fully pass without a database.** It stops at "Collecting page data" with `DATABASE_URL is not set` unless `.env.local` exists. That failure is expected and unrelated to your change. The signals that matter are `✓ Compiled successfully` and `Finished TypeScript`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/progress.mjs` | **Create.** One pure function: how many peaks everyone has climbed. No DOM, no React, no key-format knowledge. |
| `lib/progress.d.mts` | **Create.** Types for the above, matching the `lib/map/*.d.mts` pattern. |
| `test/progress.test.mjs` | **Create.** Node tests for the counter. |
| `app/checklist.tsx` | **Modify.** Owns `collapsed`; wraps the tabs in `.table-controls`; renders the fold-all button. |
| `app/checklist-table.tsx` | **Modify.** Heading becomes a disclosure button; rows render conditionally; heading shows the fraction. |
| `app/globals.css` | **Modify.** `.table-controls`, `.fold-all`, `.group-toggle`, `.group-arrow`; mobile pinning; reduced-motion. |

Each task below leaves the tree compiling and the feature in a working (if progressively prettier) state.

---

### Task 1: The pure progress counter

**Files:**
- Create: `lib/progress.mjs`
- Create: `lib/progress.d.mts`
- Test: `test/progress.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/progress.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: FAIL. The run errors while loading `test/progress.test.mjs` with `Cannot find module` for `../lib/progress.mjs`. The other four test files still pass.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/progress.mjs`:

```js
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
```

Create `lib/progress.d.mts`:

```ts
export declare function countFullyClimbed(
  mountainIds: number[],
  personIds: number[],
  isClimbed: (personId: number, mountainId: number) => boolean,
): number;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS, `# pass 40` (33 existing + 5 new), `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/progress.mjs lib/progress.d.mts test/progress.test.mjs
git commit -m "Add a pure counter for peaks everyone has climbed"
```

---

### Task 2: Fold the rows

State and the disclosure control land together, because a required prop added on one side without the other does not compile.

**Files:**
- Modify: `app/checklist.tsx`
- Modify: `app/checklist-table.tsx`

- [ ] **Step 1: Add the state to `Checklist`**

In `app/checklist.tsx`, immediately after the `selectedIds` `useMemo` (it ends with `[people, excludedIds],\n  );`), insert:

```tsx
  // Which prefectures are folded shut. Collapsed rather than expanded, for the
  // same reason excludedIds above stores exclusions: an empty set already means
  // "everything open", which is the default, and a prefecture added to the
  // database later shows up open without having to be initialised into
  // anything. An expanded set would need seeding with all 28 keys and would
  // silently fold whatever arrived after it.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
```

- [ ] **Step 2: Pass the two new props down**

In the same file, replace this line:

```tsx
              <ChecklistTable mountains={mountains} people={people} entries={entries} onSave={save} />
```

with:

```tsx
              <ChecklistTable
                mountains={mountains}
                people={people}
                entries={entries}
                onSave={save}
                collapsed={collapsed}
                onToggleGroup={(prefecture) =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(prefecture)) next.delete(prefecture);
                    else next.add(prefecture);
                    return next;
                  })
                }
              />
```

- [ ] **Step 3: Accept the props in `ChecklistTable`**

In `app/checklist-table.tsx`, replace the component signature:

```tsx
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
```

with:

```tsx
export function ChecklistTable({
  mountains,
  people,
  entries,
  onSave,
  collapsed,
  onToggleGroup,
}: {
  mountains: Mountain[];
  people: Person[];
  entries: Record<string, Entry>;
  onSave: (personId: number, mountainId: number, next: Entry) => void;
  collapsed: Set<string>;
  onToggleGroup: (prefecture: string) => void;
}) {
```

- [ ] **Step 4: Turn the heading into a button and fold the rows**

Still in `app/checklist-table.tsx`, replace this opening:

```tsx
        {groups.map((group) => (
          <Fragment key={group.prefecture}>
            <tr className="group">
              <th colSpan={5 + people.length}>
                <span lang="ja">{group.prefectureJa}</span>
                <span className="prefecture-en">
                  {group.prefecture} · {group.mountains.length}
                </span>
              </th>
            </tr>
            {group.mountains.map((m) => (
```

with:

```tsx
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.prefecture);

          return (
          <Fragment key={group.prefecture}>
            <tr className="group">
              <th colSpan={5 + people.length}>
                {/* A real button, so focus, Enter, Space and the disclosure
                    role all come for free. aria-expanded carries the state and
                    the arrow is aria-hidden, because it says the same thing
                    again in a way a screen reader should not repeat. */}
                <button
                  type="button"
                  className="group-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => onToggleGroup(group.prefecture)}
                >
                  <span className="group-arrow" aria-hidden="true">▸</span>
                  <span lang="ja">{group.prefectureJa}</span>
                  <span className="prefecture-en">
                    {group.prefecture} · {group.mountains.length}
                  </span>
                </button>
              </th>
            </tr>
            {/* Unmounted rather than hidden: a display:none row still costs
                layout and still sits in the accessibility tree. */}
            {isCollapsed ? null : group.mountains.map((m) => (
```

- [ ] **Step 5: Close the new block body**

The `groups.map` callback now has a block body, so its closing needs the extra brace. At the end of the `<tbody>`, replace:

```tsx
          </Fragment>
        ))}
      </tbody>
```

with:

```tsx
          </Fragment>
          );
        })}
      </tbody>
```

- [ ] **Step 6: Verify it compiles and nothing regressed**

Run: `npm run typecheck && npm test`

Expected: typecheck prints no errors; tests report `# pass 40`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add app/checklist.tsx app/checklist-table.tsx
git commit -m "Fold a prefecture's mountains from its heading"
```

---

### Task 3: Style the disclosure control

Without this the heading is a beni pill from the global `button` rule, sitting on top of the mist band.

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add the reset and the arrow**

In `app/globals.css`, find the `tr.group th .prefecture-en` rule (it ends with `color: var(--mizu);\n}`) and insert immediately after it:

```css
/* The heading is a button now, so it arrives carrying the global button rule's
   beni pill -- padding, 2px border, background, white text and its own
   letter-spacing -- on top of the mist band. All of it has to go. `font:
   inherit` takes family, size, weight and style in one go; letter-spacing is
   not part of that shorthand, so it is listed separately. */
.group-toggle {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  width: 100%;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  border-radius: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: left;
  cursor: pointer;
}

/* One glyph rotated, not two glyphs swapped: ▸ and ▾ have different advance
   widths, so swapping them would shift the prefecture name sideways on every
   fold. inline-block because transform does not apply to inline boxes. */
.group-arrow {
  display: inline-block;
  font-size: 0.7em;
  color: var(--mizu);
  transition: transform 120ms ease;
}

.group-toggle[aria-expanded="true"] .group-arrow {
  transform: rotate(90deg);
}
```

- [ ] **Step 2: Respect reduced motion**

Find this block (it is the first of the two `prefers-reduced-motion` blocks in the file):

```css
@media (prefers-reduced-motion: reduce) {
  td.person input[type="checkbox"] {
    transition: none;
  }
}
```

Replace it with:

```css
@media (prefers-reduced-motion: reduce) {
  td.person input[type="checkbox"],
  .group-arrow {
    transition: none;
  }
}
```

- [ ] **Step 3: Verify the stylesheet is still balanced**

Run:

```bash
node -e "const s=require('fs').readFileSync('app/globals.css','utf8');let d=0,m=0;for(const c of s){if(c==='{')d++;else if(c==='}'){d--;if(d<m)m=d;}}console.log('depth',d,'min',m)"
```

Expected: `depth 0 min 0`. Anything else means a brace was lost.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "Style the prefecture disclosure arrow"
```

---

### Task 4: Show progress on a folded heading

**Files:**
- Modify: `app/checklist-table.tsx`

- [ ] **Step 1: Import the counter**

In `app/checklist-table.tsx`, after the existing `import { key } from "./checklist";` line, add:

```tsx
import { countFullyClimbed } from "@/lib/progress.mjs";
```

- [ ] **Step 2: Compute the label**

Replace the line added in Task 2:

```tsx
          const isCollapsed = collapsed.has(group.prefecture);
```

with:

```tsx
          const isCollapsed = collapsed.has(group.prefecture);
          // A peak counts only once everyone has it -- the rule the map already
          // states out loud as "climbed by both", so the two views cannot
          // report different things about the same data. With nobody on the
          // roster that is vacuously true of every peak, so the fraction gives
          // way to the plain count rather than claiming a full sweep of a list
          // no one has touched.
          const done = countFullyClimbed(
            group.mountains.map((m) => m.id),
            people.map((p) => p.id),
            (personId, mountainId) => entries[key(personId, mountainId)]?.climbed ?? false,
          );
          const countLabel =
            isCollapsed && people.length > 0
              ? `${done}/${group.mountains.length}`
              : `${group.mountains.length}`;
```

- [ ] **Step 3: Use it in the heading**

Replace:

```tsx
                  <span className="prefecture-en">
                    {group.prefecture} · {group.mountains.length}
                  </span>
```

with:

```tsx
                  <span className="prefecture-en">
                    {group.prefecture} · {countLabel}
                  </span>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`

Expected: typecheck prints no errors; `# pass 40`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add app/checklist-table.tsx
git commit -m "Trade a folded heading's peak count for its progress"
```

---

### Task 5: The fold-all button

**Files:**
- Modify: `app/checklist.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Derive the fold-all target**

In `app/checklist.tsx`, add `useMemo` usage beside the new state — immediately after the `const [collapsed, setCollapsed]` line from Task 2, insert:

```tsx
  // Only needed by the fold-all button, and derived rather than stored so it
  // cannot fall out of step with the roster.
  const allPrefectures = useMemo(
    () => new Set(mountains.map((m) => m.prefecture)),
    [mountains],
  );
```

`useMemo` is already imported at the top of this file.

- [ ] **Step 2: Wrap the tabs and add the button**

Replace the whole tabs block. Find it in full — it runs from `<div className="view-tabs"` to the `</div>` immediately before `<div id="view-panel"`:

```tsx
        <div className="view-tabs" role="tablist" aria-label="Checklist view">
          <button
            type="button"
            role="tab"
            id="tab-table"
            aria-controls="view-panel"
            aria-selected={view === "table"}
            className={view === "table" ? "on" : undefined}
            onClick={() => setView("table")}
          >
            <span lang="ja">一覧</span> <span className="view-tab-en">Table</span>
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
            <span lang="ja">地図</span> <span className="view-tab-en">Map</span>
          </button>
        </div>
```

and replace all of it with this — the two tab buttons are unchanged, only re-indented one level:

```tsx
        <div className="table-controls">
          <div className="view-tabs" role="tablist" aria-label="Checklist view">
            <button
              type="button"
              role="tab"
              id="tab-table"
              aria-controls="view-panel"
              aria-selected={view === "table"}
              className={view === "table" ? "on" : undefined}
              onClick={() => setView("table")}
            >
              <span lang="ja">一覧</span> <span className="view-tab-en">Table</span>
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
              <span lang="ja">地図</span> <span className="view-tab-en">Map</span>
            </button>
          </div>

          {/* Deliberately a sibling of the tablist, not a child: a tablist
              should contain only tabs, and a plain button inside one reads to
              assistive technology as a third, broken tab. Table view only,
              because folding means nothing on the map. */}
          {view === "table" && mountains.length > 0 ? (
            <button
              type="button"
              className="fold-all"
              onClick={() =>
                setCollapsed((current) => (current.size === 0 ? new Set(allPrefectures) : new Set()))
              }
            >
              <span lang="ja">{collapsed.size === 0 ? "全閉" : "全開"}</span>{" "}
              <span className="view-tab-en">{collapsed.size === 0 ? "Fold all" : "Show all"}</span>
            </button>
          ) : null}
        </div>
```

A fresh `new Set(allPrefectures)` rather than `allPrefectures` itself, so the memoised set is never handed to the setter and then mutated by a later toggle.

- [ ] **Step 3: Move the tab underline up a level**

This is the step that is easy to miss. `.view-tabs` is currently a block, so its `border-bottom` spans the whole sheet. As a flex item inside `.table-controls` it shrinks to the width of the two tabs, and the line under them would shrink with it.

In `app/globals.css`, replace:

```css
.view-tabs {
  display: flex;
  gap: 0;
  margin: 0 0 -1px;
  border-bottom: 1px solid var(--sumi);
}
```

with:

```css
/* The rule under the tabs, and the -1px that tucks it beneath the panel, live
   here rather than on .view-tabs: as a flex item that element now shrinks to
   its two tabs, and the line would shrink with it instead of spanning the
   sheet. flex-end keeps the button sitting on the line with the tabs. */
.table-controls {
  display: flex;
  align-items: flex-end;
  margin: 0 0 -1px;
  border-bottom: 1px solid var(--sumi);
}

.view-tabs {
  display: flex;
  gap: 0;
}
```

- [ ] **Step 4: Make `.view-tab-en` reusable and style the button**

The italic English label is currently scoped to tabs only. Replace:

```css
.view-tabs button .view-tab-en {
  font-family: var(--font-en);
  font-size: 12px;
  font-style: italic;
}
```

with:

```css
/* Unscoped from .view-tabs button so the fold-all button shares one treatment
   rather than duplicating it. */
.view-tab-en {
  font-family: var(--font-en);
  font-size: 12px;
  font-style: italic;
}
```

Then add, immediately after the `.view-tabs button.on` rule:

```css
/* Matches the tabs' own reset of the global button rule -- padding, border,
   background and letter-spacing all restated -- so it sits on the same line
   without becoming a beni pill. */
.fold-all {
  margin-left: auto;
  padding: 6px 14px;
  font-family: var(--font-ja);
  font-size: 15px;
  letter-spacing: 0.06em;
  color: var(--sumi-faint);
  background: var(--washi-deep);
  border: 1px solid var(--rule);
  border-bottom: none;
  cursor: pointer;
}

.fold-all:hover {
  color: var(--sumi);
}
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run typecheck && npm test && node -e "const s=require('fs').readFileSync('app/globals.css','utf8');let d=0,m=0;for(const c of s){if(c==='{')d++;else if(c==='}'){d--;if(d<m)m=d;}}console.log('depth',d,'min',m)"
```

Expected: no typecheck errors; `# pass 40`, `# fail 0`; `depth 0 min 0`.

- [ ] **Step 6: Commit**

```bash
git add app/checklist.tsx app/globals.css
git commit -m "Add one button that folds or unfolds every prefecture"
```

---

### Task 6: Keep the arrow reachable on a phone

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Pin the toggle inside the horizontal scroller**

Under 720px the table is a horizontal scroller, and the heading cell spans `colSpan={5 + people.length}` — the full table width. Scrolled right, the arrow and the prefecture name leave the screen entirely.

In `app/globals.css`, inside the `@media (max-width: 720px)` block, find the `th.person` rule:

```css
  th.person {
    overflow-wrap: break-word;
  }
```

and insert immediately after it:

```css
  /* The heading cell is as wide as the table, so scrolled right the arrow and
     the name would be off-screen with no way back to them. Pinned at the left
     edge like the name and height columns already are. max-content rather than
     100%: a full-width sticky element has nothing to slide against and would
     never appear to move. The tap target shrinks to the label, which is the
     price of the arrow always being there. */
  .group-toggle {
    position: sticky;
    left: 0;
    width: max-content;
  }
```

- [ ] **Step 2: Verify**

Run:

```bash
npm run typecheck && npm test && node -e "const s=require('fs').readFileSync('app/globals.css','utf8');let d=0,m=0;for(const c of s){if(c==='{')d++;else if(c==='}'){d--;if(d<m)m=d;}}console.log('depth',d,'min',m)"
```

Expected: no typecheck errors; `# pass 40`, `# fail 0`; `depth 0 min 0`.

- [ ] **Step 3: Confirm the whole thing compiles as a production build**

Run: `npm run build 2>&1 | grep -E "Compiled successfully|Finished TypeScript|DATABASE_URL"`

Expected: `✓ Compiled successfully` and `Finished TypeScript`. A trailing `DATABASE_URL is not set` is expected without `.env.local` and is not a failure of this change.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "Pin the prefecture arrow while the table scrolls sideways"
```

---

## Manual verification

None of this is reachable from `node --test`, so it has to be done in a browser with a database attached (`npm run dev`).

- [ ] Every one of the 28 headings has an arrow, including the 13 single-mountain prefectures.
- [ ] Clicking a heading folds its rows; clicking again restores them.
- [ ] The arrow rotates rather than jumping, and the prefecture name does not shift sideways as it does.
- [ ] Tab reaches each arrow in document order. Both Enter and Space toggle it.
- [ ] A folded heading reads `4/9`; open, it reads `9`.
- [ ] A prefecture where everyone has climbed everything reads `2/2` when folded.
- [ ] On first switching to 一覧 *Table* the button reads 全閉 *Fold all* — note the app opens on 地図 *Map*, so there is no button until you switch. It flips to 全開 *Show all* after the first individual fold, and returns to 全閉 *Fold all* only when the last folded group reopens.
- [ ] *Fold all* leaves 28 heading rows and no mountain rows; the table header still lines up with the pinned name and height columns.
- [ ] Fold a few groups, then add a friend. The folds survive (that is a soft `router.refresh()`).
- [ ] Switch to 地図 *Map*: the fold-all button disappears. Switch back: it returns with the folds intact.
- [ ] The line under the tabs still spans the full sheet, not just the two tabs.
- [ ] On a phone, scroll the table right, then confirm the arrow is still at the left edge and still toggles.
- [ ] With an empty roster (no people), a folded heading shows the plain count and never `9/9`.
- [ ] **Safari specifically:** tick a checkbox, then click 全閉 with the mouse. Confirm focus is not stranded — the next Tab should resume near the tab row, not at the top of the document. Safari and Firefox on macOS do not focus a button on click. This is now handled in code — both toggles call `event.currentTarget.focus()` before updating state — so this check is a regression guard rather than a known gap.
- [ ] On a phone, fold and unfold a group while the table is scrolled right. The pinned heading's width changes with it, since `· 4/19` is wider than `· 19` — confirm that reads as breathing rather than as a glitch.
- [ ] The fold-all button does not read as a third tab. It should sit at the right end of the tab row as bare text, with no box of its own.

## Out of scope

Per the spec: no persistence across a hard reload, no per-person fractions in the heading, no folding on the map, no region-level nesting, and no `aria-controls`.
