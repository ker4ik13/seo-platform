import { isIP } from "node:net";
import { readBoundedRequestBody } from "./platform-api-proxy.ts";
import type { NextRequest } from "next/server";
import {
  platformApiInternalOrigin,
  webPublicOrigin
} from "./server-runtime-origin.ts";

const ALLOWED_METHODS = new Set(["GET", "POST"]);
const AUTH_PATHS = new Set([
  "auth/login",
  "auth/logout",
  "auth/refresh",
  "auth/mfa/challenge/verify"
]);
const ADMIN_ROOTS = new Set([
  "me",
  "billing",
  "staff",
  "workspaces",
  "projects",
  "operations",
  "refund-requests",
  "provider-accounts",
  "overview",
  "usage-reviews"
]);
const MAX_BODY_BYTES = 64 * 1_024;

export async function proxyAdminApi(
  request: NextRequest,
  path: readonly string[]
): Promise<Response> {
  const upstreamPath = adminUpstreamPath(path);
  if (!ALLOWED_METHODS.has(request.method) || !upstreamPath) {
    return errorResponse(404, "NOT_FOUND", "API route not found");
  }
  const origin = request.headers.get("origin");
  const expectedOrigin = webPublicOrigin();
  if (origin && (!expectedOrigin || origin !== expectedOrigin)) {
    return errorResponse(
      403,
      "FORBIDDEN",
      "Cross-origin admin requests are not allowed"
    );
  }
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor
    ? canonicalClientIp(forwardedFor)
    : undefined;
  if (forwardedFor && !clientIp) {
    return errorResponse(
      400,
      "VALIDATION_FAILED",
      "Forwarded client address is invalid"
    );
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
    return errorResponse(413, "FILE_TOO_LARGE", "Request body is too large");
  }
  let body: ArrayBuffer | undefined;
  if (request.method === "POST" && request.body) {
    const bounded = await readBoundedRequestBody(request, MAX_BODY_BYTES, 10_000);
    if (!bounded.ok) return bounded.response;
    body = bounded.body;
  }

  const headers = new Headers({ Accept: "application/json" });
  for (const name of [
    "accept-language",
    "content-type",
    "cookie",
    "idempotency-key",
    "if-match",
    "if-none-match",
    "user-agent",
    "x-csrf-token"
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (origin) headers.set("origin", origin);
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  if (request.method === "POST" && !headers.has("x-csrf-token")) {
    const csrf = request.cookies.get(
      process.env.AUTH_CSRF_COOKIE_NAME ?? "seo_csrf"
    )?.value;
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      new URL(
        `${upstreamPath}${request.nextUrl.search}`,
        platformApiInternalOrigin()
      ),
      {
        method: request.method,
        headers,
        ...(body && body.byteLength > 0 ? { body } : {}),
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000)
      }
    );
  } catch {
    return errorResponse(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Platform API is unavailable"
    );
  }

  const responseHeaders = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/json"
  });
  for (const name of ["etag", "x-api-version", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of responseCookies(upstream.headers)) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

export function adminUpstreamPath(
  segments: readonly string[]
): string | undefined {
  if (
    segments.length === 0 ||
    segments.length > 6 ||
    segments.some((segment) => !/^[a-z0-9-]{1,80}$/u.test(segment))
  ) {
    return undefined;
  }
  const joined = segments.join("/");
  if (AUTH_PATHS.has(joined)) {
    return `/api/v1/${joined}`;
  }
  if (!ADMIN_ROOTS.has(segments[0] ?? "")) return undefined;
  if (
    segments[0] === "provider-accounts" &&
    !(
      segments.length === 1 ||
      (segments.length === 2 && segments[1] === "refresh") ||
      (segments.length === 3 && segments[2] === "enabled")
    )
  ) return undefined;
  if (segments[0] === "overview" && segments.length !== 1) return undefined;
  if (segments[0] === "refund-requests" && !(segments.length === 1 || segments.length === 3 && ["decision", "confirm-manual", "reconcile-provider"].includes(segments[2] ?? ""))) return undefined;
  if (segments[0] === "me" && segments.length !== 1) return undefined;
  if (
    segments[0] === "billing" &&
    !(
      (segments[1] === "plans" && segments.length === 2) ||
      (segments[1] === "npd-receipts" && segments.length <= 4)
    )
  ) {
    return undefined;
  }
  if (
    segments[0] === "billing" &&
    segments.length === 4 &&
    !["register-manual", "cancel-manual", "replace-manual"].includes(
      segments[3] ?? ""
    )
  ) {
    return undefined;
  }
  if (
    segments[0] === "staff" &&
    (segments[1] !== "roles" ||
      segments.length > 4 ||
      (segments.length === 4 && segments[3] !== "revoke"))
  ) {
    return undefined;
  }
  if (
    segments[0] === "workspaces" &&
    !(
      segments.length === 1 ||
      (segments.length === 3 && segments[2] === "subscription-grants")
    )
  ) {
    return undefined;
  }
  if (
    segments[0] === "projects" &&
    segments.length !== 1
  ) {
    return undefined;
  }
  if (
    segments[0] === "operations" &&
    !(
      segments.length === 1 ||
      (segments.length === 2 && UUID_PATTERN.test(segments[1] ?? ""))
    )
  ) {
    return undefined;
  }
  return `/admin-api/v1/${joined}`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function responseCookies(headers: Headers): readonly string[] {
  const extended = headers as Headers & {
    readonly getSetCookie?: () => readonly string[];
  };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function canonicalClientIp(value: string): string | undefined {
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > 45 ||
    candidate.includes(",") ||
    candidate.includes("%") ||
    isIP(candidate) === 0
  ) {
    return undefined;
  }
  return candidate;
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
      headers: { "Cache-Control": "private, no-store" }
    }
  );
}
