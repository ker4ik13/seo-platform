import { webPublicOrigin } from "./server-runtime-origin.ts";

const RELAY_PORT = "9443";
const MAX_RELAY_DURATION_MS = 15 * 60_000;

export async function relayObjectStorageUpload(
  request: Request
): Promise<Response> {
  if (request.method !== "PUT") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const publicOrigin = webPublicOrigin();
  const browserOrigin = request.headers.get("origin");
  if (browserOrigin && browserOrigin !== publicOrigin) {
    return errorResponse(
      403,
      "FORBIDDEN",
      "Cross-origin storage relay requests are not allowed"
    );
  }

  const signedUrlValue = request.headers.get("x-seo-storage-url");
  const signedUrl = parseSignedStorageUrl(signedUrlValue, publicOrigin);
  if (!signedUrl) {
    return errorResponse(400, "INVALID_UPLOAD_URL", "Upload URL is invalid");
  }
  if (!request.body) {
    return errorResponse(400, "EMPTY_UPLOAD_PART", "Upload part is empty");
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");
  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, {
      method: "PUT",
      headers,
      body: request.body,
      duplex: "half",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(MAX_RELAY_DURATION_MS)
      ])
    } as RequestInit & { duplex: "half" });
  } catch {
    return errorResponse(
      502,
      "STORAGE_UNAVAILABLE",
      "Object storage is unavailable"
    );
  }

  if (!upstream.ok) {
    return errorResponse(
      502,
      "STORAGE_UPLOAD_FAILED",
      `Object storage rejected the upload part with status ${upstream.status}`
    );
  }
  const etag = upstream.headers.get("etag");
  if (!etag) {
    return errorResponse(
      502,
      "STORAGE_ETAG_MISSING",
      "Object storage did not return an ETag"
    );
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      ETag: etag
    }
  });
}

function parseSignedStorageUrl(
  value: string | null,
  publicOrigin: string
): URL | undefined {
  if (!value) return undefined;
  let candidate: URL;
  let publicUrl: URL;
  try {
    candidate = new URL(value);
    publicUrl = new URL(publicOrigin);
  } catch {
    return undefined;
  }
  if (
    candidate.protocol !== "https:" ||
    candidate.hostname !== publicUrl.hostname ||
    candidate.port !== RELAY_PORT ||
    candidate.username ||
    candidate.password ||
    candidate.hash ||
    !candidate.searchParams.has("X-Amz-Signature") ||
    !candidate.searchParams.has("uploadId") ||
    !candidate.searchParams.has("partNumber")
  ) {
    return undefined;
  }
  return candidate;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "private, no-store" }
    }
  );
}
