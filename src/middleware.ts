import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge-safe gate: checks only cookie presence and redirects to /login.
 * Real session validation (SQLite lookup) happens in route handlers and
 * server components, which run in the Node runtime.
 */
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/manifest.webmanifest", "/sw.js", "/icons", "/offline"];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const hasSession = request.cookies.has("mp_session");
  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|ico|webp|woff2)$).*)"],
};
