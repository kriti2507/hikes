# Public Reads, Admin Writes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the checklist readable by anyone while restricting every write to a
logged-in admin, replacing the whole-site password gate.

**Architecture:** `requireAdmin()` at the top of each server action is the security
boundary; `proxy.ts` is deleted. A client `AdminProvider` seeded from a server-read
`isAdmin` renders one imperatively-positioned tooltip, and a `Locked` wrapper makes
edit affordances inert and explains why on hover.

**Tech Stack:** Next.js 16 (App Router, server actions, `proxy.ts` convention),
React 19.2, TypeScript, plain CSS, Postgres via `pg`.

**Spec:** `docs/superpowers/specs/2026-09-15-admin-auth-design.md`

---

## Before you start

Read `AGENTS.md`. This is Next.js 16, which renamed the `middleware.ts`
convention to `proxy.ts` — do not reintroduce a `middleware.ts`. The relevant
bundled docs, if you need them, are:

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`

Two commands verify everything in this plan; there are no unit tests to add
(see "Why no new tests" at the end):

```
npm run typecheck
npm test
```

`npm test` covers the map's pure `.mjs` modules and must stay green — nothing
in this plan touches them, so a failure there means something unrelated broke.

**Task order matters.** The site is gated by `proxy.ts` until Task 7, so at no
commit is it both public *and* ungated. That means the visitor UI cannot be
tested until Task 7 either: until then, everything but `/login` redirects.

**Task 1: Server auth helpers**

**Files:**
- Modify: `lib/auth.ts`

- [ ] **Step 1: Rewrite `lib/auth.ts`**

`AUTH_COOKIE` and `expectedToken` are unchanged. `sitePassword` stops throwing
and returns `null` for "not configured", and two new helpers answer the
question the rest of the app asks.

```ts
// Single shared password, no user accounts.
//
// The cookie holds a SHA-256 digest of the password plus a fixed label. It is
// unforgeable without knowing the password, which is all this needs to do: the
// point is to keep strangers out of the edit controls if the URL is shared, not
// to separate users from each other. Reading the checklist needs no cookie at
// all.

import { cookies } from "next/headers";

export const AUTH_COOKIE = "hikes_auth";

export async function expectedToken(password: string) {
  const data = new TextEncoder().encode(`hyakumeizan-checklist:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Null means no password is configured, which is dev mode: a fresh clone is
// editable without a login step. An empty string counts as unset rather than as
// a one-character password nobody meant to set.
export function sitePassword() {
  return process.env.SITE_PASSWORD || null;
}

export async function isAdmin() {
  const password = sitePassword();
  if (password === null) return true;

  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  return token !== undefined && token === (await expectedToken(password));
}

// The security boundary. Called by every write in app/actions.ts; the dimmed
// controls a visitor sees are an explanation, not an enforcement.
export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Only admin can make changes.");
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: FAIL, with exactly one error — `proxy.ts(9,47)`, passing
`sitePassword()` where a `string` is required now that it is `string | null`.
That is the expected intermediate state; Task 7 deletes the file. Do not "fix"
it with a non-null assertion.

`app/login/actions.ts` and `app/actions.ts` also call `sitePassword()`, but both
only compare it with `!==`, which TypeScript allows against `string | null`. So
they typecheck clean while being wrong at runtime: in dev mode `sitePassword()`
is `null`, so `submitted !== null` is always true and `signIn` would bounce
every password. Tasks 2 and 3 replace both call sites, and nothing exercises
dev mode until then.

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "Let the site answer who is admin instead of only whether to let them in"
```

---

## Task 2: Gate the writes, drop the per-action passwords

**Files:**
- Modify: `app/actions.ts`
- Modify: `app/banner.tsx:54-146` (`PersonActions`)

`updatePerson` and `deletePerson` lose their `password` parameter, so their only
caller has to change in the same commit to keep the typecheck green.

- [ ] **Step 1: Replace the header and `setAscent`/`addPerson` in `app/actions.ts`**

Replace lines 1–38 (the imports, the stale middleware comment, `setAscent` and
`addPerson`) with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Reads are public; every write gates itself. There is no route-level gate any
// more -- proxy.ts is gone -- so requireAdmin() here is the whole boundary.

export async function setAscent(
  personId: number,
  mountainId: number,
  climbed: boolean,
  dateClimbed: string | null,
) {
  await requireAdmin();

  await query(
    `insert into ascents (person_id, mountain_id, climbed, date_climbed)
     values ($1, $2, $3, $4)
     on conflict (person_id, mountain_id) do update
       set climbed = excluded.climbed,
           date_climbed = excluded.date_climbed,
           updated_at = now()`,
    [personId, mountainId, climbed, dateClimbed || null],
  );
}

export async function addPerson(name: string) {
  await requireAdmin();

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  await query(
    `insert into people (name, sort_order)
     values ($1, coalesce((select max(sort_order) from people), 0) + 1)
     on conflict (name) do nothing`,
    [trimmed],
  );
  revalidatePath("/");
}
```

- [ ] **Step 2: Delete `confirmPassword` from `app/actions.ts`**

Delete this function entirely — being logged in is the authorization now:

```ts
function confirmPassword(password: unknown) {
  if (typeof password !== "string" || password !== sitePassword()) throw new Error("Wrong password");
}
```

Leave `confirmPersonId` and `isUniqueViolation` alone.

- [ ] **Step 3: Regate `updatePerson` and `deletePerson`**

Replace both function signatures and their first lines. `updatePerson`:

```ts
export async function updatePerson(personId: number, name: string) {
  await requireAdmin();
  confirmPersonId(personId);
```

`deletePerson`:

```ts
export async function deletePerson(personId: number) {
  await requireAdmin();
  confirmPersonId(personId);
```

Everything below those two lines in each function is unchanged.

- [ ] **Step 4: Drop the password field from `PersonActions` in `app/banner.tsx`**

Remove the `password` state and everything that touches it. The resulting
component, replacing lines 54–146:

```tsx
function PersonActions({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [name, setName] = useState(person.name);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(nextMode: "edit" | "delete") {
    setMode(nextMode);
    setName(person.name);
    setError(null);
  }

  function close() {
    if (pending) return;
    setMode("closed");
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        if (mode === "edit") await updatePerson(person.id, name);
        else if (mode === "delete") await deletePerson(person.id);
        setMode("closed");
        onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save that change.");
      }
    });
  }

  if (mode === "closed") {
    return (
      <span className="person-actions">
        <button type="button" className="text-button" onClick={() => open("edit")}>
          Edit
        </button>
        <button type="button" className="text-button danger-text" onClick={() => open("delete")}>
          Delete
        </button>
      </span>
    );
  }

  return (
    <form className="person-action-form" onSubmit={submit}>
      {mode === "edit" ? (
        <>
          <label htmlFor={`edit-person-${person.id}`}>New name</label>
          <input
            id={`edit-person-${person.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            autoFocus
          />
        </>
      ) : (
        <p>Delete {person.name} and all of their ascents?</p>
      )}
      {error ? <span className="error">{error}</span> : null}
      <span className="person-form-buttons">
        <button
          type="submit"
          className={mode === "delete" ? "danger-button" : undefined}
          disabled={pending || (mode === "edit" && !name.trim())}
        >
          {pending ? "Saving…" : mode === "edit" ? "Save" : "Delete"}
        </button>
        <button type="button" className="secondary-button" onClick={close} disabled={pending}>
          Cancel
        </button>
      </span>
    </form>
  );
}
```

Note the delete confirmation ("Delete X and all of their ascents?") stays. It
guards against a misclick, which is a different concern from authorization.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: FAIL with exactly one error, still `proxy.ts(9,47)` from Task 1. If
`app/banner.tsx` or `app/actions.ts` appears, a call site was missed.

- [ ] **Step 6: Commit**

```bash
git add app/actions.ts app/banner.tsx
git commit -m "Move authorization from a password per action to the session"
```

---

## Task 3: Dev mode, sign out, and the login page's other two states

**Files:**
- Modify: `app/login/actions.ts`
- Modify: `app/login/page.tsx`
- Modify: `app/globals.css` (login section, around line 760)

- [ ] **Step 1: Rewrite `app/login/actions.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, expectedToken, sitePassword } from "@/lib/auth";

export async function signIn(formData: FormData) {
  const password = sitePassword();
  // Dev mode: nothing is configured, so there is nothing to check and no cookie
  // worth setting -- isAdmin() already answers true for every request.
  if (password === null) redirect("/");

  const submitted = String(formData.get("password") ?? "");
  if (submitted !== password) redirect("/login?error=1");

  (await cookies()).set(AUTH_COOKIE, await expectedToken(submitted), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/");
}
```

- [ ] **Step 2: Rewrite `app/login/page.tsx`**

Three states: the password form, "you're logged in" with a logout button, and a
dev-mode note where there is no password to log in with.

```tsx
import { isAdmin, sitePassword } from "@/lib/auth";
import { signIn, signOut } from "./actions";

// Unlinked from the rest of the site -- the admin types the URL. Nothing here
// is a gate; app/actions.ts is.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const admin = await isAdmin();
  const configured = sitePassword() !== null;

  return (
    <main className="login">
      {admin ? (
        <form action={signOut}>
          <Title />
          {configured ? (
            <p className="login-note">You&rsquo;re logged in.</p>
          ) : (
            <p className="login-note">
              No <code>SITE_PASSWORD</code> is set, so this copy of the site is open for editing.
            </p>
          )}
          {/* Nothing to clear when no password is configured. */}
          {configured ? <button type="submit">Log out</button> : null}
        </form>
      ) : (
        <form action={signIn}>
          <Title />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoFocus autoComplete="current-password" />
          {error ? <p className="error">Wrong password.</p> : null}
          <button type="submit">Enter</button>
        </form>
      )}
    </main>
  );
}

function Title() {
  return (
    <h1>
      <span lang="ja">日本百名山</span>
      <span className="subtitle">Nihon Hyakumeizan</span>
    </h1>
  );
}
```

- [ ] **Step 3: Add `.login-note` to `app/globals.css`**

Insert immediately after the `.login label` rule (which ends around line 759):

```css
.login-note {
  margin: 0 0 0.3rem;
  font-size: 0.85rem;
  color: var(--sumi-soft);
}

.login-note code {
  font-size: 0.8em;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

Expected: one error left, in `proxy.ts`. Task 7 deletes that file.

- [ ] **Step 5: Verify by hand**

Run: `npm run dev`

With `SITE_PASSWORD` set in `.env.local`, visit `http://localhost:3000/login`:
a wrong password redirects back with "Wrong password."; the right one lands on
`/`; returning to `/login` now shows "You're logged in." and a Log out button
that returns you to the password form.

Comment `SITE_PASSWORD` out of `.env.local`, restart the dev server, and visit
`/login`: it shows the "No SITE_PASSWORD is set" note and no button. Restore
`.env.local` afterwards.

- [ ] **Step 6: Commit**

```bash
git add app/login/actions.ts app/login/page.tsx app/globals.css
git commit -m "Give /login a way out and a dev-mode state"
```

---

## Task 4: The client gating primitives

**Files:**
- Create: `app/auth.tsx`
- Modify: `app/globals.css` (new section before `/* ---------- misc ---------- */`)

- [ ] **Step 1: Create `app/auth.tsx`**

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ReactNode } from "react";

// Cosmetic gating. lib/auth.ts's requireAdmin is the security boundary; this
// exists so a visitor understands why a checkbox will not tick, rather than
// finding a dead control and assuming the page is broken.

type Admin = {
  isAdmin: boolean;
  show: (x: number, y: number) => void;
  hide: () => void;
};

const AdminContext = createContext<Admin>({
  isAdmin: false,
  show: () => {},
  hide: () => {},
});

export function useAdmin() {
  return useContext(AdminContext);
}

export function AdminProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const tooltip = useRef<HTMLDivElement>(null);

  // Written straight to the DOM rather than held in React state. The table is
  // 100 rows by however many people, so a provider that re-rendered on every
  // pointer move would re-render all of it; this way the provider renders once
  // and never again.
  const show = useCallback((x: number, y: number) => {
    const node = tooltip.current;
    if (!node) return;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.display = "block";
  }, []);

  const hide = useCallback(() => {
    const node = tooltip.current;
    if (node) node.style.display = "none";
  }, []);

  const value = useMemo(() => ({ isAdmin, show, hide }), [isAdmin, show, hide]);

  return (
    <AdminContext.Provider value={value}>
      {children}
      {/* One node for the whole page. aria-hidden because `inert` has already
          taken the control it describes out of the accessibility tree, so there
          is nothing left there for this to annotate. */}
      <div ref={tooltip} className="admin-tooltip" aria-hidden="true">
        Only admin can make changes
      </div>
    </AdminContext.Provider>
  );
}

// Wraps one edit affordance. The admin gets the children untouched.
export function Locked({ children, className }: { children: ReactNode; className?: string }) {
  const { isAdmin, show, hide } = useAdmin();
  if (isAdmin) return <>{children}</>;

  return (
    // A div, not a span: one call site wraps a <form>, which is flow content
    // and cannot legally sit inside a span. Every place this lands -- a <td>,
    // an <li> -- takes a div, and `display: inline-block` gets the inline
    // behaviour back where it is wanted.
    <div
      className={className ? `admin-locked ${className}` : "admin-locked"}
      onPointerEnter={(event) => show(event.clientX, event.clientY)}
      onPointerMove={(event) => show(event.clientX, event.clientY)}
      onPointerLeave={hide}
    >
      {/* pointer-events: none on the content hands hover to the wrapper: a
          disabled form control swallows pointer events in Chrome and WebKit, so
          `disabled` alone would leave nothing to hover and no way to say why.
          `inert` takes the content out of the tab order and the accessibility
          tree -- React 19 accepts it as a boolean prop. */}
      <div className="admin-locked-content" inert>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles to `app/globals.css`**

Insert a new section immediately before the `/* ---------- misc ---------- */`
comment (around line 759, after the login rules):

```css
/* ---------- admin gating ---------- */

/* An edit affordance as a visitor sees it: inert, and explaining itself on
   hover. See app/auth.tsx -- the server is the actual boundary. */
.admin-locked {
  display: inline-block;
  cursor: not-allowed;
}

/* Hover belongs to the wrapper, not to the controls inside it. */
.admin-locked-content {
  pointer-events: none;
}

/* Buttons and form fields are affordances, so dimming them says "not for you".
   The seals are not -- see .locked-cell below. */
.admin-locked.locked-control .admin-locked-content {
  opacity: 0.55;
}

/* A table cell. Two reasons this is not the default: `td.person .date` is
   width: 100%, which resolves against a shrink-to-fit inline-block and
   collapses; and the seal is the data this page exists to show, so it keeps its
   own opacity (0.3 unchecked, 1 checked) rather than being dimmed on top of it.
   Dimming here would make an unchecked cell almost invisible to the very
   audience the page is now public for. */
.admin-locked.locked-cell,
.admin-locked.locked-cell .admin-locked-content {
  display: block;
}

/* A peak-card row. The li is a flex row of label + date, so the wrapper stands
   in for it instead of collapsing both into one flex child. */
.admin-locked.locked-row {
  flex: 1;
}

.admin-locked.locked-row .admin-locked-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

/* One node, shared by every locked affordance and moved by hand. position:
   fixed is viewport-relative here because no ancestor carries a transform --
   notably it is a sibling of <main>, not a child of the map's panned group. */
.admin-tooltip {
  display: none;
  position: fixed;
  z-index: 50;
  transform: translate(-50%, calc(-100% - 10px));
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--rule);
  background: var(--washi-deep);
  color: var(--sumi-soft);
  font-family: var(--font-en);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
  pointer-events: none;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: still exactly one error, in `proxy.ts`. If `inert` is reported as an
unknown prop, the React types did not resolve — check
`node_modules/@types/react/index.d.ts` contains `inert?: boolean` rather than
casting the prop away.

- [ ] **Step 4: Commit**

```bash
git add app/auth.tsx app/globals.css
git commit -m "Add the wrapper that makes an edit control inert and say why"
```

---

## Task 5: Wire the provider through, and add Log out

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/checklist.tsx:58-67` and its return
- Modify: `app/banner.tsx` (the `Banner` component)
- Modify: `app/globals.css`

- [ ] **Step 1: Read `isAdmin` in `app/page.tsx`**

Add the import:

```ts
import { isAdmin } from "@/lib/auth";
```

Change the destructuring on line 7 and add a fourth promise at the end of the
`Promise.all` array (after the `ascents` query), then pass it down:

```tsx
  const [mountains, people, ascents, admin] = await Promise.all([
```

```tsx
    query<Ascent>(
      `select person_id   as "personId",
              mountain_id as "mountainId",
              climbed,
              date_climbed as "dateClimbed"
         from ascents
        where climbed or date_climbed is not null`,
    ),
    isAdmin(),
  ]);

  return <Checklist mountains={mountains} people={people} ascents={ascents} isAdmin={admin} />;
```

The route is already `force-dynamic`, so reading a cookie costs nothing here.

- [ ] **Step 2: Mount the provider in `app/checklist.tsx`**

Add to the imports:

```ts
import { AdminProvider } from "./auth";
```

Add the prop to the signature (currently lines 58–66):

```tsx
export function Checklist({
  mountains,
  people,
  ascents,
  isAdmin,
}: {
  mountains: Mountain[];
  people: Person[];
  ascents: Ascent[];
  isAdmin: boolean;
}) {
```

Wrap the returned `<main>`. Change the `return (` on line 128 to:

```tsx
  return (
    <AdminProvider isAdmin={isAdmin}>
      <main>
```

and the closing `</main>\n  );` at the end of the component to:

```tsx
      </main>
    </AdminProvider>
  );
```

Indent the contents of `<main>` by one level to match. The provider rather than
prop drilling because `peak-card.tsx` sits three levels down —
`checklist` → `map-view` → `use-map-markers` → `peak-card` — and threading a
boolean through the marker hook would put an auth concern in a file that is
otherwise about geometry.

- [ ] **Step 3: Add Log out to `Banner` in `app/banner.tsx`**

Add to the imports:

```ts
import { signOut } from "./login/actions";
import { useAdmin } from "./auth";
```

Inside `Banner`, before the `return`:

```tsx
  const { isAdmin } = useAdmin();
```

Then add the control as the last child of `<div className="banner-text">`,
immediately after the closing `</ul>` of the tally:

```tsx
        {/* Only the admin sees this, so the page never advertises to a visitor
            that an admin exists. */}
        {isAdmin ? (
          <form action={signOut} className="banner-logout">
            <button type="submit" className="text-button">
              Log out
            </button>
          </form>
        ) : null}
```

- [ ] **Step 4: Style it in `app/globals.css`**

Add to the admin gating section created in Task 4:

```css
.banner-logout {
  margin-top: 0.9rem;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: still exactly one error, in `proxy.ts`.

- [ ] **Step 6: Verify by hand**

Run: `npm run dev`, log in at `/login`, and confirm on `/`:

- Everything still works exactly as before — ticking a peak, adding a person,
  renaming and deleting one (none of which now ask for a password).
- "Log out" appears under the tally and returns you to the password form.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/checklist.tsx app/banner.tsx app/globals.css
git commit -m "Carry the admin flag from the request down to the controls"
```

---

## Task 6: Lock the four edit affordances

**Files:**
- Modify: `app/checklist-table.tsx:142-177`
- Modify: `app/map/peak-card.tsx:97-136`
- Modify: `app/add-person.tsx`
- Modify: `app/banner.tsx` (`PersonActions`)

- [ ] **Step 1: Wrap the table cell in `app/checklist-table.tsx`**

Add to the imports:

```ts
import { Locked } from "./auth";
```

Replace the body of the `<td className="person">` (lines 146–175) so the
checkbox and its date sit inside one `Locked`:

```tsx
                      <td key={person.id} className="person">
                        <Locked className="locked-cell">
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
                        </Locked>
                      </td>
```

The CSS selectors are unaffected: they are descendant selectors
(`td.person input[type="checkbox"]`) and the per-column seal colour keys off
`td.person:nth-of-type(...)`, neither of which an intervening span disturbs.

- [ ] **Step 2: Wrap the peak-card row in `app/map/peak-card.tsx`**

Add to the imports:

```ts
import { Locked } from "../auth";
```

Replace the `<li>` body (lines 102–133) so `Locked` stands in for the flex row:

```tsx
            <li key={person.id}>
              <Locked className="locked-row">
                <label>
                  <input
                    type="checkbox"
                    checked={climbed}
                    aria-label={`${person.name} climbed ${mountain.nameEn}`}
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
              </Locked>
            </li>
```

The peak card's own close button stays outside `Locked` — a visitor must be
able to shut a card they opened.

- [ ] **Step 3: Wrap the add-person form in `app/add-person.tsx`**

Add to the imports:

```ts
import { Locked } from "./auth";
```

Wrap the whole `<form>` — the label, field and button are one affordance, and
wrapping them separately would fire the tooltip three times across one control:

```tsx
  return (
    <Locked className="locked-control">
      <form
        className="add-person"
        onSubmit={...unchanged...}
      >
        ...unchanged...
      </form>
    </Locked>
  );
```

- [ ] **Step 4: Wrap the Edit/Delete buttons in `app/banner.tsx`**

Add `Locked` to the existing `./auth` import from Task 5:

```ts
import { Locked, useAdmin } from "./auth";
```

In `PersonActions`, wrap the closed-state buttons:

```tsx
  if (mode === "closed") {
    return (
      <Locked className="locked-control">
        <span className="person-actions">
          <button type="button" className="text-button" onClick={() => open("edit")}>
            Edit
          </button>
          <button type="button" className="text-button danger-text" onClick={() => open("delete")}>
            Delete
          </button>
        </span>
      </Locked>
    );
  }
```

The open edit/delete form below needs no wrapper: a visitor can never reach it,
because the only way in is a button that is now inert.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: still exactly one error, in `proxy.ts`.

- [ ] **Step 6: Commit**

```bash
git add app/checklist-table.tsx app/map/peak-card.tsx app/add-person.tsx app/banner.tsx
git commit -m "Dim the edit controls for anyone who is not logged in"
```

---

## Task 7: Delete the whole-site gate

This is the commit that makes the site public. Everything that needs to be
guarded is guarded by now.

**Files:**
- Delete: `proxy.ts`

- [ ] **Step 1: Delete the file**

```bash
git rm proxy.ts
```

Nothing else references it — `next.config.ts` is empty and the convention is
file-based. Do not replace it with a `middleware.ts`; that convention is gone
in Next 16.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS, with no output. This is the first clean typecheck since Task 1.

- [ ] **Step 3: Run the existing tests**

Run: `npm test`

Expected: PASS, 25 tests. Nothing in this plan touches the map maths; a failure
here is unrelated.

- [ ] **Step 4: Commit**

```bash
git commit -m "Open the checklist to everyone and keep the edits to the admin"
```

---

## Task 8: Documentation

**Files:**
- Modify: `env.example`
- Modify: `README.md:1-5` and the "### 2. Password" section

- [ ] **Step 1: Update `env.example`**

Replace the `SITE_PASSWORD` comment and line at the end of the file:

```
# The admin password, in plain text. Anyone can read the checklist; only someone
# who has logged in at /login can change it. Leave this unset for local work and
# every request counts as the admin, with no login step.
SITE_PASSWORD=change-me
```

- [ ] **Step 2: Update the README intro**

Replace line 4 ("Next.js + Postgres, deployed on Vercel. One page, one shared
password.") with:

```
Next.js + Postgres, deployed on Vercel. One page, readable by anyone; edits need
the admin password.
```

- [ ] **Step 3: Replace the README's "### 2. Password" section**

```markdown
### 2. Password

Set `SITE_PASSWORD` in `.env.local` and in Vercel's environment variables.

Anyone can read the checklist. To change it — tick a peak, set a date, add or
rename or delete a person — go to `/login` and enter that password. The page is
not linked from anywhere; type the URL. A visitor sees every edit control dimmed
with a tooltip explaining why, and the server rejects the write regardless, so
the dimming is an explanation rather than the lock.

Leaving `SITE_PASSWORD` unset means every request counts as the admin. That is
the local default: clone, `npm run db:setup`, `npm run dev`, edit. Set it in
production.

There are no accounts, and the password is stored as plain text in the
environment rather than hashed — it guards one person's checklist from passing
strangers, and a hash would only help against someone who can already read the
deployment's environment.
```

- [ ] **Step 4: Update the deploying section**

In the "## Deploying" section, the sentence "...and set the two environment
variables (`DATABASE_URL` comes from the Neon integration, `SITE_PASSWORD` you
choose)" is still correct. Leave it.

- [ ] **Step 5: Commit**

```bash
git add README.md env.example
git commit -m "Say in the docs that reading is open and editing is not"
```

---

## Task 9: Full verification

No commit here unless a check fails and you fix something.

- [ ] **Step 1: Typecheck, test, build**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all three pass. `npm run build` needs `DATABASE_URL` set to something
well-formed even though it never queries — see the README's "Building" section.

- [ ] **Step 2: Walk the visitor checks**

`npm run dev` with `SITE_PASSWORD` set, in a private window (no cookie):

1. `/` renders the map, the table and the tallies — no redirect to `/login`.
2. Every climbed checkbox is inert; hovering one shows "Only admin can make
   changes"; clicking does nothing.
3. Opening a peak card on the map shows the same for its checkboxes, and its
   close button still closes it.
4. The add-a-friend form and the per-person Edit/Delete buttons are inert with
   the same tooltip.
5. The 一覧/地図 tabs, prefecture folding, fold-all, the theme toggle, the
   person filter and map pan/zoom all still work.
6. No "Log out" appears anywhere.
7. Tab through the page: focus never lands inside a locked affordance.
8. The tooltip follows the pointer and sits above the map, not behind it.
9. Unchecked seals in the table are no fainter than they are for the admin.

- [ ] **Step 3: Walk the admin checks**

In a normal window:

10. `/login` with a wrong password re-renders the form with "Wrong password."
11. The correct password lands on `/` with every affordance live.
12. Ticking a peak persists across a reload.
13. Add, rename and delete a person — none ask for a password, and the delete
    still confirms first.
14. "Log out" in the banner returns the page to the visitor state.

- [ ] **Step 4: Walk the dev-mode check**

Comment `SITE_PASSWORD` out of `.env.local`, restart:

15. `/` is fully editable with no login, and `/login` says no password is set.

Restore `.env.local` afterwards.

- [ ] **Step 5: Confirm the boundary holds without the UI**

The gating in Task 6 is cosmetic, so confirm the server check is not. In a
private window on `/`, open the devtools console and call the server action the
way the page would — easiest is to log in, copy the `fetch` of a successful tick
from the Network tab as cURL, then replay it with the `Cookie` header stripped:

```bash
curl -i -X POST http://localhost:3000/ \
  -H "Next-Action: <action-id-from-the-request>" \
  -H "Content-Type: text/plain;charset=UTF-8" \
  -H "Origin: http://localhost:3000" \
  --data '[1,1,true,null]'
```

Expected: the tick does not appear in the database. Next redacts the error text
in a production build, so the response body is not the thing to read — check
the row.

---

## Why no new tests

`test/` covers the two pure `.mjs` modules and the map's registration invariant.
`lib/auth.ts` cannot join them: this repo sets `allowJs: false`, so `node --test`
cannot load a `.ts` file — the same constraint that put the projection and
clustering maths in `.mjs`. Moving the auth helpers to `.mjs` would mean a
hand-written `.d.mts` and an explicit extension on every import, for two
functions of four lines each.

The README is already explicit that components are verified by running the app.
Task 9 is that verification.
