import type { NextRequest } from "next/server";
import { readBoundedRequestBody } from "./platform-api-proxy.ts";
import { workerGatewayInternalOrigin } from "./server-runtime-origin.ts";

const ALLOWED_PATHS = new Set([
  "heartbeat", "claim", "rank/claim", "rank/complete", "rank/complete-batch",
  "work/complete", "work/upload/init", "work/upload/parts"
]);
const WORKER_TOKEN = /^Bearer wn_[A-Za-z0-9_-]{43}$/u;
const WORKER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Exact public ingress for the authenticated Jobs Worker Gateway only. */
export async function proxyWorkerGateway(request: NextRequest, path: readonly string[]): Promise<Response> {
  const route = path.join("/");
  if (process.env.WORKER_GATEWAY_ENABLED !== "true" || request.method !== "POST" ||
    !ALLOWED_PATHS.has(route) || request.nextUrl.search) return failure(404, "NOT_FOUND");
  const authorization = request.headers.get("authorization");
  const nodeId = request.headers.get("x-worker-id");
  if (!authorization || !WORKER_TOKEN.test(authorization) || !nodeId || !WORKER_ID.test(nodeId)) {
    return failure(401, "UNAUTHORIZED");
  }
  if (request.headers.has("origin") || request.headers.has("cookie") ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return failure(403, "FORBIDDEN");
  }
  const maximum = route === "rank/complete-batch" ? 1_048_576 : route === "rank/complete" ? 16 * 1_048_576 : 8 * 1_048_576;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return failure(413, "FILE_TOO_LARGE");
  const body = await readBoundedRequestBody(request, maximum, 30_000);
  if (!body.ok) return body.response;
  let upstream: Response;
  try {
    upstream = await fetch(new URL(`/worker/v1/${route}`, workerGatewayInternalOrigin()), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authorization,
        "X-Worker-Id": nodeId
      },
      ...(body.body ? { body: body.body } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(route === "work/complete" ? 115_000 : route === "claim" ? 25_000 : 30_000)
    });
  } catch {
    return failure(503, "DEPENDENCY_UNAVAILABLE");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/json"
    }
  });
}

function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}
