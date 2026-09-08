import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { installPrivateHttpResponsePolicy, serializeRequestForLog } from "./http-response-policy.js";
import { Writable } from "node:stream";

test("Jobs access logging excludes private URL values, search text and credentials", async t => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { lines.push(String(chunk)); done(); } });
  const app = Fastify({ logger: { stream, serializers: { req: serializeRequestForLog } } });
  app.get("/internal/v1/results/:reference", async () => ({ ok: true }));
  t.after(async () => app.close());
  await app.inject({ method: "GET", url: "/internal/v1/results/private-reference-canary?search=private-keyword-canary", headers: { authorization: "Bearer private-auth-canary", cookie: "secret=private-cookie-canary" } });
  const log = lines.join("");
  assert.ok(log.includes("/internal/v1/results/:reference"));
  for (const privateValue of ["private-reference-canary", "private-keyword-canary", "private-auth-canary", "private-cookie-canary"]) assert.equal(log.includes(privateValue), false);
});

test("keeps success, error and unknown Jobs responses private", async (t) => {
  const app = Fastify({ logger: false });
  installPrivateHttpResponsePolicy(app);
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/unsafe", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    reply.header("Vary", "Accept-Encoding, origin");
    return { status: "ok" };
  });
  app.get("/guarded", async () => {
    const error = new Error("Denied") as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  });
  await app.ready();
  t.after(async () => app.close());

  for (const url of ["/health/live", "/unsafe", "/guarded", "/missing"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(
      response.headers["content-security-policy"],
      "frame-ancestors 'none'"
    );
    assert.equal(response.headers["referrer-policy"], "no-referrer");
  }

  const unsafe = await app.inject({ method: "GET", url: "/unsafe" });
  assert.equal(
    unsafe.headers.vary,
    "Accept-Encoding, origin, Authorization, Cookie"
  );
});

test("adds preflight cache dimensions without duplicate Vary fields", async (t) => {
  const app = Fastify({ logger: false });
  installPrivateHttpResponsePolicy(app);
  await app.ready();
  t.after(async () => app.close());

  const response = await app.inject({ method: "OPTIONS", url: "/unknown" });

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
