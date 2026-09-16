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

// The unset-password warning is worth saying once a process, not once a
// request: a deployment that lost the variable keeps serving, so the per-request
// version would bury the rest of the log for as long as the mistake lasts.
let warnedUnset = false;

export async function isAdmin() {
  const password = sitePassword();
  if (password === null) {
    // Unset means "everyone is admin" only under `next dev`. A built deployment
    // that lost the variable -- a project transfer, a preview branch with its
    // own env -- would otherwise serve live edit controls to the internet while
    // looking exactly as intended, and the first symptom would be a stranger
    // editing rows. So it fails closed instead: the checklist stays readable,
    // nobody can write, and the missing variable is loud.
    if (process.env.NODE_ENV === "production") {
      if (!warnedUnset) {
        warnedUnset = true;
        console.error("SITE_PASSWORD is not set. The checklist is readable but nobody can edit it.");
      }
      return false;
    }
    return true;
  }

  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  return token !== undefined && token === (await expectedToken(password));
}

// The security boundary. Called by every write in app/actions.ts; the dimmed
// controls a visitor sees are an explanation, not an enforcement.
export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Only admin can make changes.");
}
