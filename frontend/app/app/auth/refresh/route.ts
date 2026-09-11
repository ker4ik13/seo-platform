import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  proxyPlatformApi,
  responseCookies
} from "../../../../lib/platform-api-proxy";
import { safeAppReturnTo } from "../../../../lib/app-path";
import { webPublicOrigin } from "../../../../lib/server-runtime-origin";
import { coalescedServerSessionRefresh } from "../../../../lib/session-refresh-coordination";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return coalescedServerSessionRefresh(
    refreshRequestFingerprint(request),
    () => proxyPlatformApi(request, ["auth", "refresh"], {
      csrfFromCookie: true
    })
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = safeAppReturnTo(
    request.nextUrl.searchParams.get("returnTo")
  );
  const refreshRequest = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers
  });
  const refreshed = await POST(refreshRequest);

  if (refreshed.ok) {
    const response = NextResponse.redirect(
      new URL(returnTo, webPublicOrigin())
    );
    copySetCookies(refreshed, response);
    return response;
  }

  const response = NextResponse.redirect(
    new URL(
      `/app/login?reason=session-expired&returnTo=${encodeURIComponent(returnTo)}`,
      webPublicOrigin()
    )
  );
  clearSessionCookies(response);
  return response;
}

function copySetCookies(source: Response, target: NextResponse): void {
  for (const setCookie of responseCookies(source.headers)) {
    target.headers.append("Set-Cookie", setCookie);
  }
}

function clearSessionCookies(response: NextResponse): void {
  for (const name of [
    process.env.AUTH_ACCESS_COOKIE_NAME ?? "seo_access",
    process.env.AUTH_SESSION_COOKIE_NAME ?? "seo_session",
    process.env.AUTH_CSRF_COOKIE_NAME ?? "seo_csrf"
  ]) {
    response.cookies.delete(name);
  }
}

function refreshRequestFingerprint(request: NextRequest): string | undefined {
  const refreshCookie = request.cookies.get(
    process.env.AUTH_SESSION_COOKIE_NAME ?? "seo_session"
  )?.value;
  const csrfCookie = request.cookies.get(
    process.env.AUTH_CSRF_COOKIE_NAME ?? "seo_csrf"
  )?.value;
  if (!refreshCookie || !csrfCookie) return undefined;
  return createHash("sha256")
    .update(refreshCookie)
    .update("\0")
    .update(csrfCookie)
    .update("\0")
    .update(request.headers.get("user-agent") ?? "")
    .digest("base64url");
}
