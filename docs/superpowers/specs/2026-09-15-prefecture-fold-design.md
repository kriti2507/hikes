# Folding prefecture groups

Date: 2026-09-15

Each prefecture heading in the 一覧 table gains a disclosure arrow that folds its
mountains away, and the tab row gains one button that folds or unfolds every
prefecture at once. A folded heading trades its peak count for a progress
fraction, so a closed table still tells you which prefectures are finished.

The table is 100 rows under 28 headings. Thirteen of those headings hold a single
mountain and four hold seven or more — Nagano alone holds nineteen. Folding is
what turns that scroll into an index you can read at once, which matters most on
a phone, where the whole table is now a horizontal scroller as well.

## Scope

| File | Change |
| --- | --- |
| `app/checklist.tsx` | Owns `collapsed`; wraps the tabs in `.table-controls`; renders the fold-all button |
| `app/checklist-table.tsx` | Group heading becomes a disclosure button; mountain rows render conditionally |
| `lib/progress.mjs` | New — `countFullyClimbed`, pure |
| `lib/progress.d.mts` | New — types for the above |
| `app/globals.css` | `.table-controls`, `.fold-all`, `.group-toggle`, `.group-arrow`; `.view-tab-en` unscoped from `.view-tabs button` so both buttons share it; mobile pinning; reduced-motion |
| `test/progress.test.mjs` | New |

No runtime dependency is added. No schema change. No query change.

## The rule

Every prefecture gets an arrow, including the thirteen that hold one mountain. An
arrow on a single-peak heading buys little on its own, but without it "fold all"
would leave thirteen groups stubbornly showing their row and no way to close
them, and the heading text would shift horizontally between groups that have an
arrow and groups that do not.

The table opens with everything expanded. Folding is something you reach for, not
a state you have to undo before the checklist looks like a checklist.

One button serves both directions. It reads 全閉 *Fold all* while everything is
open and 全開 *Show all* the moment anything is folded — always the action that
does something. It follows the bilingual pattern of the 一覧 *Table* and 地図
*Map* tabs beside it.

## Architecture

### Collapsed, not expanded

`Checklist` holds the state, beside the `excludedIds` it already owns:

```ts
const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
```

Storing which prefectures are *closed* rather than which are open is the same
argument `checklist.tsx` already makes for `excludedIds`: "everyone is shown by
default" holds for a person who did not exist when the component last rendered,
because there is nothing to initialise them into. An empty set is the
all-expanded default for free, and a prefecture added to the database later
appears expanded without any reconciliation against the roster. Storing the
expanded set instead would need seeding with all 28 keys up front and would
silently fold anything new.

The key is `mountain.prefecture`. That is already the grouping identity in
`ChecklistTable` and already the React key on each group's `Fragment`, so no new
notion of identity is introduced.

Nothing else is stored. The global button's label and its action both read
`collapsed.size === 0` directly, so the label cannot disagree with what is on
screen — including when all 28 have been folded one at a time. Its target set is
built inside the click handler:

```tsx
current.size === 0 ? new Set(mountains.map((m) => m.prefecture)) : new Set()
```

An earlier draft of this section hoisted that into a `useMemo` named
`allPrefectures`. It was inlined during review: the value is read only on a
press, so there was nothing to cache between presses, and the memo cost an
allocation on every render that *wasn't* one. It does duplicate one fact
`ChecklistTable`'s `groups` also knows — that a group is one distinct
`prefecture` string — and the two have to keep agreeing, because `collapsed`
keys on exactly that.

`ChecklistTable` gains two props, `collapsed: ReadonlySet<string>` and
`onToggleGroup: (prefecture: string) => void`, and owns no fold state of its
own. `ReadonlySet` because the table must never mutate the container's state
object in place — React compares by reference, so nothing would re-render.

### The heading is a real button

```jsx
<tr className="group">
  <th colSpan={5 + people.length}>
    <button
      type="button"
      className="group-toggle"
      aria-expanded={!isCollapsed}
      onClick={(event) => {
        event.currentTarget.focus();
        onToggleGroup(group.prefecture);
      }}
    >
      <span className="group-arrow" aria-hidden="true" />
      <span lang="ja">{group.prefectureJa}</span>
      <span className="prefecture-en">
        {group.prefecture} · {countLabel}
      </span>
    </button>
  </th>
</tr>
{!isCollapsed && group.mountains.map(/* unchanged */)}
```

`personIds` and the `isClimbed` predicate are hoisted above the group loop,
since both are the same for every heading. The rest is per group, and the count
is computed only in the branch that displays it:

```ts
const personIds = people.map((p) => p.id);
const isClimbed = (personId: number, mountainId: number) =>
  entries[key(personId, mountainId)]?.climbed ?? false;

// ...per group:
const isCollapsed = collapsed.has(group.prefecture);
const n = group.mountains.length;
const countLabel =
  isCollapsed && personIds.length > 0
    ? `${countFullyClimbed(group.mountains.map((m) => m.id), personIds, isClimbed)}/${n}`
    : `${n}`;
```

An open heading therefore never calls the counter at all, and folding 28 groups
costs less work than leaving them open, which mounts 100 rows of inputs instead.

`event.currentTarget.focus()` in the handler is not incidental. Safari and
Firefox on macOS do not focus a button on click, so a fold that unmounts the
checkbox holding focus would drop it to `<body>` and the next Tab would restart
at the top of the document. Programmatic focus after a pointer event does not
match `:focus-visible`, so mouse users see no stray ring. The map's fan controls
manage focus deliberately for the same reason.

A native `<button>` rather than a click handler on the `th`, so focus, Enter,
Space and the screen-reader role all come for free.

**It needs a full reset, and this is load-bearing.** The base `button` rule in
`app/globals.css` sets `padding: 0.42rem 1.2rem`, a beni background, a 2px border
and its own `letter-spacing`. Dropped unreset into a heading that has its own
mist background and colour, it would repaint the whole band. So `.group-toggle`
resets `appearance`, `border`, `border-radius`, `background`, `color`, `font` and
`letter-spacing` to inherit, and takes `display: flex` with
`align-items: baseline` to hold the arrow and the two labels on one line. The
zoom controls needed exactly this reset for exactly this reason; it is the second
time this base rule has caught a small control. `font: inherit` rather than a
`font-family`/`font-size` pair, because the shorthand carries `line-height` with
it — the pair would leave the UA's `normal` in place and the heading would lose a
pixel or two of height.

The button also takes the heading's **vertical** padding, `2.25rem 0 0.45rem`,
while the cell keeps only `0 0.6rem`. That relocation changes no pixel of layout
and does not move the mist band, but it is what makes the whole ~78px band
clickable. Left on the cell, the padding sat *outside* the button, so `width:
100%` bought full width and a single ~21px line box of height — three quarters
of what looks like a heading you can press doing nothing, and a ~21px touch
target on mobile.

### The arrow is drawn, not typed

```css
.group-arrow {
  width: 0.42em;
  height: 0.42em;
  background: var(--mizu);
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  transition: transform 120ms ease, background-color 120ms ease;
}
.group-toggle[aria-expanded="true"] .group-arrow { transform: rotate(90deg); }
```

An earlier draft specified the glyph `▸` (U+25B8) rotated by CSS. Review found
that character is in **none** of the fonts this page declares — not Hiragino
Mincho ProN, not Yu Mincho, not Songti SC, not Georgia, not the generic `serif`
— so it fell through to whatever the system happened to substitute, at whatever
advance width and optical size that font chose, with a tofu risk on minimal
font sets. A `clip-path` triangle is the same shape everywhere, and an
explicitly sized box gives the rotation an exact centre to pivot about.

The polygon already points right, so the collapsed state needs no transform and
`transform` carries nothing but the turn. Rotated rather than swapped for a
second shape, so the label beside it never shifts sideways as it folds. The
transition joins the existing `prefers-reduced-motion` block.

One subtlety worth recording, because it cost a review round: the arrow is
lifted off the text baseline with `position: relative; top: -0.08em`, **not**
`margin-bottom`. A flex item with no in-flow line boxes has its baseline
synthesized from its border box, so no margin edge can shift it — `margin-bottom`
measurably moves the arrow 0px and only grows the flex line.

### Folding unmounts rows

A folded prefecture renders no `<tr>` at all, rather than hiding rows with
`display: none`. A hidden row still costs layout and still sits in the
accessibility tree; an absent one costs nothing. This also keeps the fold
independent of the two columns the mobile breakpoint collapses to zero width,
which is a distinction that has already caused one layout bug in this table.

### The global button is not a tab

`.view-tabs` carries `role="tablist"`, and a tablist should contain only tabs — a
plain button inside it reads to assistive technology as a third, broken tab. So
the tabs get a flex parent and the button becomes its sibling:

```jsx
<div className="table-controls">
  <div className="view-tabs" role="tablist" aria-label="Checklist view">…</div>
  {view === "table" && mountains.length > 0 ? (
    <button type="button" className="fold-all" onClick={…}>
      <span lang="ja">{collapsed.size === 0 ? "全閉" : "全開"}</span>{" "}
      <span className="view-tab-en">{foldAllLabel}</span>
    </button>
  ) : null}
</div>
```

It renders only in table view, because folding means nothing on the map, and only
when there are mountains to fold. `.table-controls` is
`display: flex; align-items: flex-end` with the button pushed over by
`margin-left: auto`.

## Data

A folded heading shows `${done}/${n}`; an open one shows `${n}`, exactly as
today. A peak counts toward `done` once **every** person on the roster has it
ticked. That is the same rule the map applies when it says "N of 100 climbed by
both".

The two are not guaranteed to agree, though, and an earlier draft of this
section wrongly claimed they were. The map applies that rule to the people
currently ticked in its person filter, not to the roster: `use-map-markers.ts`
divides by `selectedIds.length`, and `person-filter.tsx` picks "by both" or "by
all N" from the selected count. So with three people, untick one chip on the map
and it reads "12 of 100 climbed by all 2" while a folded Nagano in the table
still reads `0/19`. Same data, different denominators.

There is a second such difference, smaller and also accepted: the map's total is
`placed.length`, the peaks it could actually position, so a mountain with no
coordinates is invisible to it — which is why the map surfaces a `missing` count
at all. The table's denominator is every mountain in the prefecture, coordinates
or not.

That is accepted rather than fixed. The filter is a map control — the table
shows a column per person instead — so the whole roster is the only roster the
table has. What would be wrong is threading `selectedIds` into the table to make
the numbers match, because the table's columns would then disagree with its own
headings.

With an empty roster, "climbed by everyone" is vacuously true of every peak,
which would render a triumphant `9/9` for a checklist nobody has touched. So the
fraction is suppressed when `people.length === 0` and the plain count shows
instead.

The counter is pure and lives in `lib/progress.mjs`, matching how the map's pure
modules are structured:

```js
/** How many of `mountainIds` every one of `personIds` has climbed.
    Returns 0 for an empty roster — the caller suppresses the fraction there. */
export function countFullyClimbed(mountainIds, personIds, isClimbed)
```

It takes an `isClimbed(personId, mountainId)` predicate rather than the entries
map, so it never learns the `"personId:mountainId"` key format and cannot drift
from `checklist.tsx`'s `key()`. `ChecklistTable` supplies the closure.

## Mobile

The heading spans `colSpan={5 + people.length}`, so inside the horizontal
scroller its cell is as wide as the whole table. Scrolled right, the arrow and
the prefecture name leave the screen. So under 720px the toggle pins itself the
way the name and height columns already do:

```css
.group-toggle { position: sticky; left: 0; width: max-content; }
```

Above 720px there is no scroller to pin against, so it is `width: 100%`. In both
cases the button owns the heading's vertical padding, so the full height of the
band is clickable; under 720px `max-content` narrows that target to the label,
which is the price of the arrow always being reachable.

`thead` is always rendered, so even with all 28 folded the fixed table layout
still takes its column widths from the header row, and the pinned name and height
columns keep their offsets.

## Testing

`test/progress.test.mjs` covers `countFullyClimbed` in seven cases: an empty
roster, nobody climbed, one person short of everyone, everyone climbed, an empty
mountain list, a person outside the roster who must not hold a peak back, and
partial progress for a single-person roster. The sixth is the load-bearing one —
without it, an implementation that ignored `personIds` and scanned everything the
predicate knew about would pass every other test.

By hand, because none of it is reachable from a node test:

- The arrow renders as a solid triangle at all, pointing right when folded and
  down when open. It is drawn with `clip-path`, so this is the check that it
  paints rather than that a font resolved.
- The arrow in the dark theme, and its `--beni` hover, since both come from
  theme tokens.
- With `prefers-reduced-motion`, the rotation stops rather than animating.
- Tab reaches each arrow in document order; Enter and Space both toggle it.
- The fold-all label flips to 全開 *Show all* on the first individual fold, and
  back to 全閉 *Fold all* only when the last one reopens.
- Folds survive adding a friend, which is a soft `router.refresh()`.
- On a phone, scroll the table right, then confirm the arrow is still at the
  left edge and still toggles.
- With all 28 folded, the table is 28 rows and the header still lines up with
  the pinned columns.
- The two existing tab labels are unchanged, since `.view-tab-en` was unscoped
  from `.view-tabs button` to be shared with the fold-all button.

## Accessibility

`aria-expanded` on the button carries the state; the arrow is `aria-hidden`
because it says the same thing again in a way a screen reader should not repeat.

No `aria-controls`. The mountain rows are siblings of the heading row, not
children of a single container, so there is no honest element to point at.
Giving each group its own `<tbody>` would manufacture one — and to be fair to
that option, it costs one element per group rather than two, since the `<tbody>`
would replace the `<Fragment>`, and a row group with a heading is arguably what
`tbody` is for. The reason to skip it is support: `aria-controls` is patchily
implemented across screen readers, and `aria-expanded` alone on a disclosure
button is the well-supported pattern.

The button inherits the page's existing `button:focus-visible` outline, so the
focus ring needs nothing new.

## Out of scope

- **Persistence.** Folds live in React state and reset on a hard reload. Storing
  them like the theme would need either an inline pre-paint script or a
  first-paint flash of the wrong state, plus a decision about a stored
  prefecture that no longer exists.
- **A fraction per person** in the folded heading. More information than the row
  can hold on a phone.
- **Folding anything on the map.** The map groups by screen distance, not by
  prefecture.
- **Region-level folding** above prefectures. The data carries `region`, but
  nesting two levels of disclosure is a different feature.
