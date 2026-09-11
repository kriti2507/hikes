import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, expectedToken, sitePassword } from "@/lib/auth";

// Next 16's replacement for the old `middleware` convention. Gates every route
// except the login page on the shared-password cookie. Server actions POST to
// the page's own path, so the same matcher covers them.
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (token && token === (await expectedToken(sitePassword()))) return NextResponse.next();

  const login = new URL("/login", request.url);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page itself and Next's own asset routes.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
