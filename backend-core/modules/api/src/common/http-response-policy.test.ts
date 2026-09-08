import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  installHttpResponsePolicy,
  serializeRequestForLog,
  STRICT_TRANSPORT_SECURITY,
  TRUSTED_PROXY_ADDRESSES
} from "./http-response-policy.js";

async function createApp(
  nodeEnvironment: "test" | "production" = "test"
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: TRUSTED_PROXY_ADDRESSES
  });

  installHttpResponsePolicy(app, nodeEnvironment);

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ok" }));
  app.get("/api/v1/system", async () => ({ status: "ok" }));
  app.get("/internal/v1/health/live", async () => ({ status: "ok" }));
  app.get("/api/v1/private", async (_request, reply) => {
    reply.header("Vary", "Accept-Encoding, origin");
    reply.header("Cache-Control", "public, max-age=3600");
    return { status: "ok" };
  });
  app.get(
    "/api/v1/guarded",
    {
      preHandler: async () => {
        const error = new Error("Denied") as Error & {
          statusCode: number;
        };
        error.statusCode = 401;
        throw error;
      }
    },
    async () => ({ status: "unreachable" })
  );
  app.post("/api/v1/parser", async (request) => request.body);

  await app.ready();
  return app;
}

function assertSecurityHeaders(
  headers: Readonly<
    Record<string, number | string | string[] | undefined>
  >
): void {
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(
    headers["content-security-policy"],
    "frame-ancestors 'none'"
  );
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(
    headers["permissions-policy"],
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
}

test("keeps the exact public GET/HEAD allowlist free of private cache policy", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  for (const url of ["/health/live", "/health/ready", "/api/v1/system"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], undefined);
    assert.equal(response.headers.vary, undefined);
    assertSecurityHeaders(response.headers);
  }

  const headResponse = await app.inject({
    method: "HEAD",
    url: "/health/live"
  });
  assert.equal(headResponse.statusCode, 200);
  assert.equal(headResponse.headers["cache-control"], undefined);
});

test("overrides unsafe cache headers and merges private Vary fields", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/private"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(
    response.headers.vary,
    "Accept-Encoding, origin, Authorization, Cookie"
  );
  assertSecurityHeaders(response.headers);
});

test("covers internal, parser, guard and not-found responses before controllers", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const responses = [
    await app.inject({
      method: "GET",
      url: "/internal/v1/health/live"
    }),
    await app.inject({
      method: "POST",
      url: "/api/v1/parser",
      headers: { "content-type": "application/json" },
      payload: "{"
    }),
    await app.inject({ method: "GET", url: "/api/v1/guarded" }),
    await app.inject({ method: "GET", url: "/api/v1/missing" })
  ];

  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [200, 400, 401, 404]
  );

  for (const response of responses) {
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers.vary, "Authorization, Cookie, Origin");
    assertSecurityHeaders(response.headers);
  }
});

test("adds preflight cache dimensions without duplicating Vary fields", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/private"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(
    response.headers.vary,
    [
      "Authorization",
      "Cookie",
      "Origin",
      "Access-Control-Request-Headers",
      "Access-Control-Request-Method"
    ].join(", ")
  );
});

test("emits HSTS only for production requests recognized as HTTPS through one proxy hop", async (t) => {
  const app = await createApp("production");
  t.after(async () => app.close());

  const directHttp = await app.inject({
    method: "GET",
    url: "/health/live"
  });
  assert.equal(directHttp.headers["strict-transport-security"], undefined);

  const proxiedHttps = await app.inject({
    method: "GET",
    url: "/health/live",
    headers: { "x-forwarded-proto": "https" }
  });
  assert.equal(
    proxiedHttps.headers["strict-transport-security"],
    STRICT_TRANSPORT_SECURITY
  );
});


test("ignores forged forwarding headers from a public origin connection", async (t) => {
  const app = Fastify({ trustProxy: TRUSTED_PROXY_ADDRESSES });
  t.after(async () => app.close());
  app.get("/peer", async (request) => ({ ip: request.ip, protocol: request.protocol, hostname: request.hostname }));
  const response = await app.inject({
    method: "GET", url: "/peer", remoteAddress: "203.0.113.9",
    headers: { host: "api.example.test", "x-forwarded-for": "198.51.100.1", "x-forwarded-proto": "https", "x-forwarded-host": "attacker.example" }
  });
  assert.deepEqual(response.json(), { ip: "203.0.113.9", protocol: "http", hostname: "api.example.test" });
  const proxied = await app.inject({
    method: "GET", url: "/peer", remoteAddress: "127.0.0.1",
    headers: { host: "api.example.test", "x-forwarded-for": "198.51.100.1", "x-forwarded-proto": "https" }
  });
  assert.equal(proxied.json().ip, "198.51.100.1");
  assert.equal(proxied.json().protocol, "https");
});

test("request logs do not retain public-note tokens or search query data", async (t) => {
  const entries: string[] = [];
  const app = Fastify({ logger: { serializers: { req: serializeRequestForLog }, stream: { write: (line: string) => { entries.push(line); } } } });
  t.after(async () => app.close());
  app.get("/api/v1/public/project-notes/:token", async () => ({ ok: true }));
  await app.inject("/api/v1/public/project-notes/secret-share-canary?search=private-email-canary");
  const logged = entries.join("\n");
  assert.ok(logged.includes("/api/v1/public/project-notes/:token"));
  assert.ok(!logged.includes("secret-share-canary"));
  assert.ok(!logged.includes("private-email-canary"));
});
