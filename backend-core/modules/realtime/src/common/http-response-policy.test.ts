import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  installHttpResponsePolicy,
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
  app.get("/internal/v1/system", async (_request, reply) => {
    reply.header("Vary", "Accept-Encoding, origin");
    reply.header("Cache-Control", "public, max-age=3600");
    reply.header("Strict-Transport-Security", "max-age=86400; preload");
    return { status: "ok" };
  });
  app.options("/internal/v1/system", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "https://web.example");
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Vary", "Origin, Access-Control-Request-Headers");
    return reply.code(204).send();
  });
  app.get(
    "/internal/v1/guarded",
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
  app.post("/internal/v1/parser", async (request) => request.body);

  await app.ready();
  return app;
}

function assertSecurityHeaders(
  headers: Readonly<
    Record<string, number | string | string[] | undefined>
  >
): void {
  assert.equal(headers["cache-control"], "private, no-store");
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

test("enforces private security policy on every successful HTTP response", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  for (const url of ["/health/live", "/internal/v1/system"]) {
    const response = await app.inject({ method: "GET", url });

    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response.headers);
  }

  const systemResponse = await app.inject({
    method: "GET",
    url: "/internal/v1/system"
  });
  assert.equal(
    systemResponse.headers.vary,
    "Accept-Encoding, origin, Authorization, Cookie"
  );
});

test("covers parser, guard and not-found responses before controllers", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const responses = [
    await app.inject({
      method: "POST",
      url: "/internal/v1/parser",
      headers: { "content-type": "application/json" },
      payload: "{"
    }),
    await app.inject({
      method: "GET",
      url: "/internal/v1/guarded"
    }),
    await app.inject({
      method: "GET",
      url: "/internal/v1/missing"
    })
  ];

  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [400, 401, 404]
  );

  for (const response of responses) {
    assert.equal(response.headers.vary, "Authorization, Cookie, Origin");
    assertSecurityHeaders(response.headers);
  }
});

test("adds preflight dimensions without losing or duplicating Vary fields", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "OPTIONS",
    url: "/internal/v1/system"
  });

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://web.example"
  );
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.equal(
    response.headers.vary,
    [
      "Origin",
      "Access-Control-Request-Headers",
      "Authorization",
      "Cookie",
      "Access-Control-Request-Method"
    ].join(", ")
  );
  assertSecurityHeaders(response.headers);
});

test("emits HSTS only for production HTTPS from the nearest trusted proxy", async (t) => {
  const app = await createApp("production");
  t.after(async () => app.close());

  const directHttp = await app.inject({
    method: "GET",
    url: "/internal/v1/system"
  });
  assert.equal(directHttp.headers["strict-transport-security"], undefined);

  const nearestProxyHttp = await app.inject({
    method: "GET",
    url: "/health/live",
    headers: { "x-forwarded-proto": "https, http" }
  });
  assert.equal(
    nearestProxyHttp.headers["strict-transport-security"],
    undefined
  );

  const proxiedHttps = await app.inject({
    method: "GET",
    url: "/health/live",
    headers: { "x-forwarded-proto": "http, https" }
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
