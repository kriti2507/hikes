# Public Reads, Admin Writes — Design

**Date:** 2026-09-15
**Status:** Approved

## Objective

Anyone can read the checklist. Only the admin can change it. Today the site is
the other way round: `proxy.ts` redirects every route to `/login` unless the
shared-password cookie matches, so a stranger sees nothing at all.

After this change the map, the table, and every tally are public. Edit
affordances stay *visible* to visitors but are inert, and explain themselves on
hover with **"Only admin can make changes"**. The admin logs in at `/login`,
which stays unlinked — you type the URL.

This ports the pattern already running in the `small_wins` project
(`docs/superpowers/specs/2026-07-10-admin-auth-design.md` there). The one
deliberate departure: the password is stored in plain text in an environment
variable, not as a hash. There is one admin and one password; a hash would
protect against an attacker who can already read the deployment's environment,
which is not a threat this site is defending against.

## Approach

The server is the security boundary. Every write server action calls
`requireAdmin()` and throws without a valid cookie. The client gating is
cosmetic — it exists so visitors understand why a checkbox will not tick, not
to keep them out.

`proxy.ts` is **deleted**. It is the whole-site gate, and with reads public
there is no route left for it to redirect. This is the load-bearing step of the
change: the comment at the top of `app/actions.ts` currently reads "Reachable
only behind middleware.ts, which covers server-action POSTs to `/` because they
use the page's own path." That stops being true the moment the proxy is gone,
so each action has to carry its own check.

## Configuration

| Variable | Purpose |
|---|---|
| `SITE_PASSWORD` | The admin password, plain text. Unset means dev mode. |

The name is kept rather than renamed to `ADMIN_PASSWORD` so no Vercel
environment change is needed. `env.example` and the README gain a note that it
now gates writes rather than the whole site.

**Dev mode:** if `SITE_PASSWORD` is unset, every request is treated as admin.
This matches `small_wins` and keeps local work unchanged — clone, `npm run
db:setup`, `npm run dev`, edit. Today `sitePassword()` throws when the variable
is missing, which means the app refuses to start; that goes away.

## Server

### `lib/auth.ts`

`AUTH_COOKIE` and `expectedToken` are unchanged. The cookie keeps holding a
SHA-256 digest of the password plus a fixed label — that is what makes it
unforgeable without knowing the password, and it costs nothing to keep. (It is
no longer verified from the edge runtime, since `proxy.ts` is gone, but Web
Crypto works the same under Node.)

Three changes:

- `sitePassword()` returns `string | null` instead of throwing. `null` is dev
  mode.
- New `isAdmin(): Promise<boolean>` — `true` in dev mode; otherwise reads
  `AUTH_COOKIE` via `next/headers` and compares it to `expectedToken`.
- New `requireAdmin(): Promise<void>` — throws `new Error("Only admin can make
  changes.")` when `isAdmin()` is false.

### `app/actions.ts`

`await requireAdmin()` as the first statement of all four writes: `setAscent`,
`addPerson`, `updatePerson`, `deletePerson`.

`confirmPassword` is deleted, along with the `password` parameter on
`updatePerson` and `deletePerson`. Being logged in *is* the authorization;
asking for the password again inside a session that already proved it is
ceremony. The delete flow keeps its "Delete X and all of their ascents?"
confirmation step — that guards against a misclick, which is a different
concern from authorization.

The stale "Reachable only behind middleware.ts" comment is replaced with one
naming `requireAdmin` as the boundary.

### `app/login/actions.ts`

`signIn` keeps its shape. Two adjustments:

- In dev mode it sets no cookie and redirects to `/` — there is nothing to
  check, and everyone is already admin.
- The cookie is otherwise set exactly as today (httpOnly, `sameSite: "lax"`,
  `secure` in production, one-year `maxAge`).

New `signOut`: deletes `AUTH_COOKIE` and redirects to `/`.

### `proxy.ts`

Deleted, along with nothing else — it has no other callers.

## Client

### `app/auth.tsx` (new)

Three exports, all client-side:

- `AdminProvider` — takes `isAdmin` as a prop (read on the server, passed
  down) and renders the single tooltip element. Its context value is
  `{ isAdmin, show, hide }` and is memoized, so it never changes identity after
  mount.
- `useAdmin()` — the hook.
- `Locked` — wraps one edit affordance.

`Locked` renders `children` untouched when `isAdmin`. Otherwise it renders a
wrapper whose content carries `pointer-events: none` and React 19's `inert`
prop: `pointer-events: none` hands hover to the wrapper (a disabled form
control swallows pointer events in Chrome and WebKit, which is why the
affordance cannot simply be `disabled`), and `inert` takes the content out of
the tab order and the accessibility tree.

`Locked` takes an optional `className`, for the same reason `small_wins`'
`AdminGate` does: an extra element in the box tree has to be told how to
disappear into the layout it landed in. See Styles.

**The tooltip is positioned imperatively.** The provider renders one absolutely
positioned div with a ref, hidden by default; `show(x, y)` writes
`style.left`, `style.top` and `style.display` directly to that node. No React
state changes on pointer movement. This matters here in a way it did not in
`small_wins`: the table is 100 rows wide by however many people, so a provider
that re-rendered on every `mousemove` would re-render the whole checklist.

While the pointer is over a locked affordance the wrapper shows
`cursor: not-allowed`.

### Wiring

`app/page.tsx` awaits `isAdmin()` alongside its three queries and passes the
result to `<Checklist>`, which mounts `AdminProvider` around its subtree.

The provider rather than prop drilling, because `peak-card.tsx` is three levels
down — `checklist` → `map-view` → `use-map-markers` → `peak-card` — and
threading a boolean through the marker hook would put an auth concern in a file
that is otherwise about geometry.

### What gets wrapped

| Affordance | File |
|---|---|
| Climbed checkbox + date input | `app/checklist-table.tsx` |
| Climbed checkbox + date input | `app/map/peak-card.tsx` |
| Add-a-friend form | `app/add-person.tsx` |
| Per-person Edit / Delete buttons | `app/banner.tsx` |

### What stays interactive for everyone

The theme toggle, the 一覧/地図 tabs, prefecture folding and fold-all, the
person filter, and map pan/zoom/ridge-fan. These are view state, not edits —
a visitor reading the map should be able to filter it.

### Log out

The banner shows a discreet "Log out" only when `isAdmin` — a form posting to
`signOut`. Visitors see nothing, so the page does not advertise that an admin
exists.

`/login` gains two states beside the password form: "You're logged in" with a
logout button when the cookie is valid, and a note that no password is
configured when in dev mode.

## Styles

New in `app/globals.css`, drawn from the existing ukiyo-e palette rather than
copied from `small_wins`:

- `.admin-locked` — `display: inline-block`, `cursor: not-allowed`.
- `.admin-locked-content` — `pointer-events: none`, and `opacity: 0.6` on the
  wrapper rather than the content, so it composes with the seal's own
  `opacity: 0.3` for an unchecked box instead of being overridden by it.
- `.admin-tooltip` — washi ground (`--washi-deep`), one `--rule` hairline, the
  same lettering as `.login label`. `position: fixed`, `pointer-events: none`,
  above the map.

Two call sites need a `className` to keep their layout, which is what the prop
is for:

- **Table cell** (`td.person`). `td.person .date` is `display: block; width:
  100%`, and a percentage width inside a shrink-to-fit `inline-block` collapses
  — so the wrapper here gets `display: block` and the cell stays 6.5rem wide.
  The selectors themselves are unaffected: they are descendant selectors
  (`td.person input[type="checkbox"]`) and the per-column seal colour keys off
  `td.person:nth-of-type(...)`, neither of which an intervening span disturbs.
  The tilt lives on the checkbox's own `--tilt`, so it survives too.
- **Peak card row** (`.peak-card-people li`). The li is a flex row with `label`
  and `.date` as its two children, spread by `justify-content: space-between`.
  Wrapping both in one element would make them a single flex child, so the
  wrapper takes `display: flex; flex: 1; justify-content: space-between` and
  stands in for the li's own row.

The add-person form and the per-person Edit/Delete buttons need nothing: both
sit in flex containers that treat an inline-block child the same as what it
replaced.

## Error handling

A write that reaches the server without a valid cookie throws. `checklist.tsx`
already handles a rejected `setAscent` by rolling the optimistic entry back and
showing "Could not save that change. Check your connection and try again." in
its error banner, so a bypassed gate fails visibly rather than silently
claiming a summit.

That message stays generic on purpose. Next redacts server-action error text in
production, so the real reason would not survive the trip anyway, and no
reachable UI path produces it — a visitor cannot click the control that sends
it.

## Testing

`test/` covers the two pure `.mjs` modules and the map's registration
invariant; the README is explicit that components are verified by running the
app. `lib/auth.ts` cannot join them — this repo sets `allowJs: false`, so
`node --test` cannot load a `.ts` file, which is the same constraint that put
the projection and clustering maths in `.mjs` to begin with. Moving the auth
helpers to `.mjs` to make them testable would mean a `.d.mts` and an extension
on every import, for two functions that are four lines each.

So: no new automated tests. `npm test` and `npm run typecheck` must stay green,
and the change is verified by hand.

### Manual checks

Logged out (or in a private window):

1. `/` renders the map, the table, and the tallies — no redirect.
2. Every climbed checkbox is inert; hovering one shows "Only admin can make
   changes"; clicking does nothing.
3. Opening a peak card on the map shows the same for its checkboxes.
4. The add-a-friend form and the per-person Edit/Delete buttons are inert with
   the same tooltip.
5. Tabs, folding, the theme toggle, the person filter and map pan/zoom all
   still work.
6. No "Log out" appears anywhere.
7. Tab through the page: focus never lands inside a locked affordance.

Logged in via `/login`:

8. A wrong password re-renders the form with "Wrong password."
9. The correct password lands on `/` with every affordance live.
10. Ticking a peak persists across a reload; so do add, rename and delete
    person — none of which ask for a password.
11. "Log out" in the banner returns the page to the visitor state.

Dev mode (`SITE_PASSWORD` unset):

12. `npm run dev` starts, and `/` is fully editable with no login.
