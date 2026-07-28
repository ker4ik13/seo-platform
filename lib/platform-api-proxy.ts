import type { NextRequest } from "next/server";
import { isSafeBrowserApiPath } from "./app-path";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const FORWARDED_REQUEST_HEADERS = [
  "accept-language",
  "content-type",
  "cookie",
  "idempotency-key",
  "if-match",
  "x-csrf-token"
] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "etag",
  "x-api-version",
  "x-request-id",
  "x-trace-id"
] as const;
const MAX_BROWSER_API_BODY_BYTES = 2 * 1_024 * 1_024;

export async function proxyPlatformApi(
  request: NextRequest,
  pathSegments: readonly string[],
  options: { readonly csrfFromCookie?: boolean } = {}
): Promise<Response> {
  if (
    !ALLOWED_METHODS.has(request.method) ||
    !isSafeBrowserApiPath(pathSegments)
  ) {
    return errorResponse(404, "NOT_FOUND", "API route not found");
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BROWSER_API_BODY_BYTES
  ) {
    return errorResponse(413, "FILE_TOO_LARGE", "Request body is too large");
  }

  const headers = new Headers({
    Accept: "application/json"
  });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (options.csrfFromCookie && !headers.has("x-csrf-token")) {
    const csrfName =
      process.env.AUTH_CSRF_COOKIE_NAME ?? "seo_csrf";
    const csrf = request.cookies.get(csrfName)?.value;
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const upstreamUrl = new URL(
    `/api/v1/${pathSegments.map(encodeURIComponent).join("/")}`,
    process.env.PLATFORM_API_INTERNAL_URL ?? "http://localhost:4000"
  );
  upstreamUrl.search = request.nextUrl.search;
  const requestOptions: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    ...(hasBody && request.body
      ? { body: request.body, duplex: "half" }
      : {}),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000)
  };

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, requestOptions);
  } catch {
    return errorResponse(
      503,
      "PROVIDER_UNAVAILABLE",
      "Platform API is unavailable"
    );
  }

  const responseHeaders = new Headers({
    "Cache-Control": "private, no-store"
  });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const setCookie of responseCookies(upstream.headers)) {
    responseHeaders.append("Set-Cookie", setCookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

export function responseCookies(headers: Headers): readonly string[] {
  const extendedHeaders = headers as Headers & {
    readonly getSetCookie?: () => readonly string[];
  };
  if (typeof extendedHeaders.getSetCookie === "function") {
    return extendedHeaders.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function errorResponse(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        retryable: status >= 500
      }
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store"
      }
    }
  );
}
