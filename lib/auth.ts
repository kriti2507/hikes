// Single shared password, no user accounts.
//
// The cookie holds a SHA-256 digest of the password plus a fixed label. It is
// unforgeable without knowing the password, which is all this needs to do: the
// point is to keep strangers out if the URL leaks, not to separate users from
// each other. Web Crypto is used so `middleware.ts` (edge runtime) can verify
// the same way the login route signs.

export const AUTH_COOKIE = "hikes_auth";

export async function expectedToken(password: string) {
  const data = new TextEncoder().encode(`hyakumeizan-checklist:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sitePassword() {
  const password = process.env.SITE_PASSWORD;
  if (!password) throw new Error("SITE_PASSWORD is not set");
  return password;
}
