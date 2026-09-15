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
