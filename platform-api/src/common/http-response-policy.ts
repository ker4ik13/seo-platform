import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

type NodeEnvironment = "development" | "test" | "production";

const PUBLIC_CACHEABLE_ROUTES = new Set([
  "/api/v1/system",
  "/health/live",
  "/health/ready"
]);

const PRIVATE_VARY_FIELDS = ["Authorization", "Cookie", "Origin"] as const;
const PREFLIGHT_VARY_FIELDS = [
  "Access-Control-Request-Headers",
  "Access-Control-Request-Method"
] as const;

export const TRUSTED_PROXY_HOPS = 1;

export const STRICT_TRANSPORT_SECURITY =
  "max-age=31536000; includeSubDomains";

function requestPath(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function isPublicCacheableRoute(request: FastifyRequest): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    PUBLIC_CACHEABLE_ROUTES.has(requestPath(request.url))
  );
}

function headerParts(
  value: number | string | readonly string[] | undefined
): string[] {
  if (value === undefined) return [];

  return (Array.isArray(value) ? value : [String(value)])
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergeVary(reply: FastifyReply, fields: readonly string[]): void {
  const existing = headerParts(reply.getHeader("Vary"));
  if (existing.includes("*")) return;

  const merged = new Map(
    existing.map((field) => [field.toLowerCase(), field] as const)
  );
  for (const field of fields) {
    if (!merged.has(field.toLowerCase())) {
      merged.set(field.toLowerCase(), field);
    }
  }

  reply.header("Vary", [...merged.values()].join(", "));
}

export function applyHttpResponsePolicy(
  request: FastifyRequest,
  reply: FastifyReply,
  nodeEnvironment: NodeEnvironment
): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Content-Security-Policy", "frame-ancestors 'none'");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );

  if (
    nodeEnvironment === "production" &&
    request.protocol === "https"
  ) {
    reply.header(
      "Strict-Transport-Security",
      STRICT_TRANSPORT_SECURITY
    );
  }

  if (isPublicCacheableRoute(request)) return;

  reply.header("Cache-Control", "private, no-store");
  mergeVary(reply, [
    ...PRIVATE_VARY_FIELDS,
    ...(request.method === "OPTIONS" ? PREFLIGHT_VARY_FIELDS : [])
  ]);
}

export function installHttpResponsePolicy(
  fastify: FastifyInstance,
  nodeEnvironment: NodeEnvironment
): void {
  fastify.addHook("onSend", async (request, reply, payload) => {
    applyHttpResponsePolicy(request, reply, nodeEnvironment);
    return payload;
  });
}
