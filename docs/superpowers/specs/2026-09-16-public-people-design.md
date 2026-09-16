# Public and Private People — Design

**Date:** 2026-09-16
**Status:** Approved — built as described. The one thing the spec does not say:
this rests on `export const dynamic = "force-dynamic"` in `app/page.tsx`, which
was already there. The page reads the auth cookie to decide who is in the
roster, so a cached render would be the one way to serve an admin's copy of the
page to a visitor.

## Objective

Reads are public today: `SITE_PASSWORD` gates writes only, so anyone with the
URL sees every person and every peak they have climbed. Not everyone on the
roster wants that. This adds a per-person switch — **Public** — that the admin
ticks in the table. Ticked, the person appears to everyone. Unticked, they
appear only to someone logged in.

A visitor sees an unticked person **not at all**: no table column, no banner
seal, no entry in the map filter, and none of their ascents. Their name is
their data too, and absence is the only version of this that cannot leak
through a view somebody forgot to cover.

The switch itself is admin-only. A visitor never sees a Public checkbox,
ticked or otherwise — there is nothing for them to learn from it and nothing
they could do with it.

## The default is public

`is_public` defaults to **true**, for people already in the database and for
people added later. Nothing that is visible today disappears when this ships,
and adding someone needs no extra step. The cost is that privacy is opt-out:
a new person is public until the admin unticks them. That is the chosen
trade-off, not an oversight — the roster is a handful of friends who are added
one at a time by the person who also owns the toggle.

## Data

```sql
alter table people
  add column if not exists is_public boolean not null default true;
```

`db/schema.sql` is applied on every `npm run db:setup` and is written to be
re-runnable, so the column is added there in that idiom rather than in a
separate migration file. Existing rows take the default and stay visible.

`Person` in `app/checklist.tsx` gains `isPublic: boolean`.

## The boundary is the query

Client-side filtering is not enough: `app/page.tsx` currently ships every
person and every ascent row to the browser, so hiding a column in React would
leave the data sitting in the page source. Both reads are narrowed instead, and
`isAdmin()` has to be resolved *before* them — the three queries that currently
sit in one `Promise.all` become an awaited `isAdmin()` followed by a
`Promise.all` of the rest.

```sql
-- people
select id, name, is_public as "isPublic"
  from people
 where $1 or is_public          -- $1 = admin
 order by sort_order, id

-- ascents
select person_id as "personId", ...
  from ascents
 where (climbed or date_climbed is not null)
   and person_id in (select id from people where $1 or is_public)
```

The ascents guard is not redundant. Ascent rows carry no names, but they carry
a private person's id, their count and exactly which peaks — which is the
sensitive part.

## Writes

One new action in `app/actions.ts`, following the shape of `updatePerson`:

```ts
export async function setPersonPublic(personId: number, isPublic: boolean)
```

`requireAdmin()` first, then `confirmPersonId`, then an `update ... returning
id` that throws "Person not found" on an empty result. It does **not**
`revalidatePath("/")` — the client already knows the new state (see below), and
a revalidate would re-render the whole table for a checkbox.

## UI

The checkbox lives in the person's column header in the table, which is the one
place on the page that is already per-person and already a header rather than
data:

```
LOGGED IN                                LOGGED OUT

#  MOUNTAIN    KRITI    VEE    ZED       #  MOUNTAIN    KRITI    ZED
              ☑ PUBLIC ☐ PUBLIC ☑ PUBLIC
1  Mt. Fuji      登      登     ·        1  Mt. Fuji      登      ·
2  Mt. Kita      登      ·      登       2  Mt. Kita      登      登
```

- A `<label>` wrapping a real `<input type="checkbox">`, the same box the map
  filter's person pills use — square, 2px corners, a drawn tick. Deliberately
  *not* the hanko seal the cells use: a seal means "climbed", and the same mark
  in the header meaning "published" would read as a column-wide tick-all.
- The box styling is extracted from `.person-check input` into a shared `.tick`
  class so the two call sites cannot drift apart.
- **The word PUBLIC does not go in the person columns.** It was meant to sit
  beside each box, and measuring the built page killed that: at six people the
  table's min-content width already equals the sheet exactly (1052px of 1052),
  so the label's ~35px came straight off the right edge — an 11px page
  scrollbar at a 1100px viewport, the last column's label clipped, and the
  table hanging past the sheet at every width. The box itself is free, being
  narrower than the seal beneath it. So the word appears once, right-aligned in
  the **notes header**, level with the row of boxes: that column is sized by
  its body text, which is wider, so the label costs nothing. It is
  `aria-hidden` — each box carries `aria-label="Show <name> on the public
  page"` — and on mobile the notes column collapses to zero width and takes the
  word with it, which is the behaviour wanted there anyway.
- Rendered only when `isAdmin`. Not wrapped in `Locked` — every other edit
  affordance on the page stays visible-but-inert so a visitor understands the
  page is editable by someone, but this control's *state* is the private thing.
  A dimmed unticked box tells a visitor that somebody is being hidden from
  them.

### The prefecture band's offset follows the header

`tr.group th` pins at `top: 2rem`, a hand-measured stand-in for the height of
`thead`. A second line in the header cells makes that wrong — for the admin
only. So the offset becomes a declared variable rather than a literal:
`--thead-h` per breakpoint (2rem, 1.9rem under 720px, 1.8rem under 430px), plus
`--public-row` set on the table only when the toggle row is present.
`tr.group th { top: calc(var(--thead-h) + var(--public-row, 0rem)) }`.

`--public-row` is **13.5px**, measured in the browser, not the ~18px the box
and its margin add up to on paper: part of that margin is absorbed by the line
box the name already had, and `thead` comes out exactly 13.48px taller at every
breakpoint. The arithmetic version pinned the band 1.24px low and opened a seam
for the rows to show through. Each `--thead-h` is deliberately ~3.7px *under*
the real header height, so the band's blank top edge tucks out of sight;
rounding 13.48 down to 13.5 keeps the logged-in seam (−3.67) identical to the
logged-out one (−3.69).

## Optimistic, like the seals

A controlled checkbox that waits for the server before it moves reads as
broken, so the toggle follows `save()` in `app/checklist.tsx`: paint the change,
persist, roll back and raise the existing error banner on failure.

State is a `Map<number, boolean>` of **overrides**, not a copy of the roster —
the same reason `excludedIds` stores exclusions and `collapsed` stores folds. A
person the map has never heard of falls back to the `isPublic` the server sent,
so a person added or renamed by a `router.refresh()` needs no reconciliation.

```ts
const roster = people.map((p) => ({ ...p, isPublic: publicOverrides.get(p.id) ?? p.isPublic }));
```

`roster` is what the banner, the table and the map filter all receive, so one
click updates every view at once.

## Everything else follows for free

The banner tally, the map filter and `countFullyClimbed` all read the `people`
array they are handed. A private person is absent from it for a visitor, so
their seal, their filter pill and their contribution to "climbed by all N"
disappear without any of those files changing.

## Edge cases

- **Every person unticked.** A visitor gets an empty roster, which today prints
  "No people yet — add someone below to start a column." — wrong on both counts
  for a visitor, who cannot add anyone and is not being told the truth about the
  database. The copy splits: the admin keeps that sentence, a visitor gets
  "Nothing is being shown publicly yet." It is deliberately silent about
  whether anyone exists.
- **Map with nobody shown.** Already handled: `summary()` prints "Nobody
  selected — tick someone to ink the map", and `countFullyClimbed` returns 0
  for an empty roster by design.
- **The admin unticks themselves mid-session.** Nothing happens to their own
  view; they are logged in. The next logged-out load drops them.

## Verification

No pure logic is added, so there is nothing for `node --test` to hold: the rule
is one SQL predicate and one conditional render. Driven instead in headless
Chrome over CDP against `next dev` and the real database, 2026-09-16:

1. **The leak test.** Logged in through `/login`, unticked V, then loaded the
   page in a cookie-less browser context: V absent from the tally seals, from
   the map filter, from the `people` payload, and — the part that matters —
   absent from the ascent rows, which came back carrying person ids 1, 6 and 9
   only. No `.public-toggle` anywhere in a visitor's DOM. Reticked, and the
   visitor saw all six again.
2. **The switch.** Six boxes, six ticked, each in its person's pigment. A click
   persists and survives a reload.
3. **Rollback.** Clicked with the network forced offline: the box snapped back,
   the error banner appeared, and a reload confirmed the database was never
   written.
4. **Geometry.** The pinned-band seam measures −3.65 to −3.69px in all six
   combinations of {visitor, admin} × {1200px, 700px, 390px} — logged in now
   behaves exactly like logged out. The admin table's width and per-column
   widths are identical to the visitor's at 1000/1100/1280/1440px.
5. No console errors, no exceptions, no failed requests.

Not fixed, and pre-existing: below about a 1070px viewport the table overflows
the document by up to 47px with six people. Same for visitors and admins — it
is the mountain and notes columns' min-content, not anything here.

## Files

| File | Change |
|---|---|
| `db/schema.sql` | `alter table people add column if not exists is_public` |
| `app/page.tsx` | await `isAdmin()` first; guard both queries; select `isPublic` |
| `app/actions.ts` | `setPersonPublic` |
| `app/checklist.tsx` | `Person.isPublic`, `publicOverrides`, `savePublic`, `roster`, visitor copy |
| `app/checklist-table.tsx` | the Public label in `th.person` |
| `app/globals.css` | `.tick` extracted from `.person-check input`; `.public-toggle`; `--thead-h` |
