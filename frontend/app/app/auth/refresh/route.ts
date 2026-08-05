import { NextRequest, NextResponse } from "next/server";
import {
  proxyPlatformApi,
  responseCookies
} from "../../../../lib/platform-api-proxy";
import { safeAppReturnTo } from "../../../../lib/app-path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = safeAppReturnTo(
    request.nextUrl.searchParams.get("returnTo")
  );
  const refreshRequest = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers
  });
  const refreshed = await proxyPlatformApi(
    refreshRequest,
    ["auth", "refresh"],
    { csrfFromCookie: true }
  );

  if (refreshed.ok) {
    const response = NextResponse.redirect(new URL(returnTo, request.url));
    copySetCookies(refreshed, response);
    return response;
  }

  const response = NextResponse.redirect(
    new URL(
      `/app/login?reason=session-expired&returnTo=${encodeURIComponent(returnTo)}`,
      request.url
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
