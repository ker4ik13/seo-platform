import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { installPrivateHttpResponsePolicy } from "./http-response-policy.js";

test("keeps success, error and unknown SEO Data responses private", async (t) => {
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
