"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, expectedToken, sitePassword } from "@/lib/auth";

export async function signIn(formData: FormData) {
  const submitted = String(formData.get("password") ?? "");
  if (submitted !== sitePassword()) redirect("/login?error=1");

  (await cookies()).set(AUTH_COOKIE, await expectedToken(submitted), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
