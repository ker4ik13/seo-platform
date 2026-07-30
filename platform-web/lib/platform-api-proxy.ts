import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { isSafeBrowserApiPath } from "./app-path.ts";

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
]);
const FORWARDED_REQUEST_HEADERS = [
  "accept-language",
  "content-type",
  "cookie",
  "idempotency-key",
  "if-match",
  "user-agent",
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
const MAX_PUSH_SUBSCRIPTION_BODY_BYTES = 8 * 1_024;
const MAX_BROWSER_API_BODY_READ_MS = 10_000;

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
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp =
    forwardedFor === null
      ? undefined
      : canonicalForwardedClientIp(forwardedFor);
  if (forwardedFor !== null && clientIp === undefined) {
    return errorResponse(
      400,
      "VALIDATION_FAILED",
      "Forwarded client address is invalid"
    );
  }
  const maxBodyBytes = browserApiBodyLimit(pathSegments);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > maxBodyBytes
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
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  if (options.csrfFromCookie && !headers.has("x-csrf-token")) {
    const csrfName =
      process.env.AUTH_CSRF_COOKIE_NAME ?? "seo_csrf";
    const csrf = request.cookies.get(csrfName)?.value;
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const boundedBody = hasBody
    ? await readBoundedRequestBody(request, maxBodyBytes)
    : { ok: true as const, body: undefined };
  if (!boundedBody.ok) return boundedBody.response;
  const upstreamUrl = new URL(
    `/api/v1/${pathSegments.map(encodeURIComponent).join("/")}`,
    process.env.PLATFORM_API_INTERNAL_URL ?? "http://localhost:4000"
  );
  upstreamUrl.search = request.nextUrl.search;
  const requestOptions: RequestInit = {
    method: request.method,
    headers,
    ...(boundedBody.body
      ? { body: boundedBody.body }
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

export function canonicalForwardedClientIp(
  value: string
): string | undefined {
  const candidate = value.trim();
  const version = isIP(candidate);
  if (
    candidate.length === 0 ||
    candidate.length > 45 ||
    candidate.includes(",") ||
    candidate.includes("%") ||
    version === 0
  ) {
    return undefined;
  }
  if (version === 4) return candidate;
  const hostname = new URL(`http://[${candidate}]/`).hostname;
  return hostname.slice(1, -1);
}

async function readBoundedRequestBody(
  request: NextRequest,
  maxBodyBytes: number
): Promise<
  | { readonly ok: true; readonly body: ArrayBuffer | undefined }
  | { readonly ok: false; readonly response: Response }
> {
  if (!request.body) {
    return { ok: true, body: undefined };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel("BFF request body read timed out").catch(() => {
      // The timeout response below remains authoritative.
    });
  }, MAX_BROWSER_API_BODY_READ_MS);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: errorResponse(
            413,
            "FILE_TOO_LARGE",
            "Request body is too large"
          )
        };
      }
      chunks.push(value);
    }
    if (timedOut) {
      return {
        ok: false,
        response: errorResponse(
          408,
          "REQUEST_TIMEOUT",
          "Request body took too long to read"
        )
      };
    }
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        "VALIDATION_FAILED",
        "Request body could not be read"
      )
    };
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: body.buffer };
}

function browserApiBodyLimit(pathSegments: readonly string[]): number {
  return pathSegments[0] === "me" && pathSegments[1] === "push-subscriptions"
    ? MAX_PUSH_SUBSCRIPTION_BODY_BYTES
    : MAX_BROWSER_API_BODY_BYTES;
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
