import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

type NodeEnvironment = "development" | "test" | "production";

const PRIVATE_VARY_FIELDS = ["Authorization", "Cookie", "Origin"] as const;
const PREFLIGHT_VARY_FIELDS = [
  "Access-Control-Request-Headers",
  "Access-Control-Request-Method"
] as const;

// Caddy connects over loopback in VPS runtime; container ingress/BFF uses
// the isolated private Docker network. Never trust a hop count alone.
export const TRUSTED_PROXY_ADDRESSES = ["loopback", "uniquelocal"];

export const STRICT_TRANSPORT_SECURITY =
  "max-age=31536000; includeSubDomains";

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
  reply.header("Cache-Control", "private, no-store");
  mergeVary(reply, [
    ...PRIVATE_VARY_FIELDS,
    ...(request.method === "OPTIONS" ? PREFLIGHT_VARY_FIELDS : [])
  ]);

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
  } else {
    reply.removeHeader("Strict-Transport-Security");
  }
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
