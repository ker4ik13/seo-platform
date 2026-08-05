import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

const PRIVATE_VARY_FIELDS = ["Authorization", "Cookie", "Origin"] as const;
const PREFLIGHT_VARY_FIELDS = [
  "Access-Control-Request-Headers",
  "Access-Control-Request-Method"
] as const;

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

export function applyPrivateHttpResponsePolicy(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Content-Security-Policy", "frame-ancestors 'none'");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
  mergeVary(reply, [
    ...PRIVATE_VARY_FIELDS,
    ...(request.method === "OPTIONS" ? PREFLIGHT_VARY_FIELDS : [])
  ]);
}

export function installPrivateHttpResponsePolicy(
  fastify: FastifyInstance
): void {
  fastify.addHook("onSend", async (request, reply, payload) => {
    applyPrivateHttpResponsePolicy(request, reply);
    return payload;
  });
}
