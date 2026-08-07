import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { canonicalHostRedirectUrl } from "./lib/canonical-host-redirect";

export function proxy(request: NextRequest): NextResponse {
  const canonicalRedirect = canonicalHostRedirectUrl(
    request.nextUrl,
    request.headers.get("host")
  );
  if (canonicalRedirect) {
    return NextResponse.redirect(canonicalRedirect, 308);
  }

  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-app-path",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr).*)"]
};
