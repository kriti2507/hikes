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
