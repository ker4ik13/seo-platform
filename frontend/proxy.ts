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

  const requestHeaders = new Headers(request.headers);
  const pathLocale = /^\/(ru|en)(?:\/|$)/u.exec(request.nextUrl.pathname)?.[1];
  const requestedLocale = /^\/app\/(?:login|register)(?:\/|$)/u.test(request.nextUrl.pathname) ? request.nextUrl.searchParams.get("locale") : null;
  const explicitLocale = pathLocale ?? (requestedLocale === "ru" || requestedLocale === "en" ? requestedLocale : undefined);
  const savedLocale = request.cookies.get("seo_ui_locale")?.value;
  const uiLocale = explicitLocale ?? (savedLocale === "en" ? "en" : "ru");
  requestHeaders.set("x-ui-locale", uiLocale);
  requestHeaders.delete("x-app-path");
  if (request.nextUrl.pathname.startsWith("/app")) requestHeaders.set("x-app-path", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
  if (explicitLocale) response.cookies.set("seo_ui_locale", explicitLocale, { path: "/", maxAge: 31536000, sameSite: "lax", secure: true });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr).*)"]
};
