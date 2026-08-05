import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { DependencyHealthService } from "./dependency-health.service.js";

const services = {
  seoData: "http://seo-data:4001",
  jobs: "http://jobs-integrations:4002",
  realtime: "http://realtime:4003"
} as const;

test("checks downstream readiness and accepts service version drift", async () => {
  const requests: string[] = [];
  const result = await withFetch(
    async (input) => {
      requests.push(String(input));
      return jsonResponse({
        service: "future-service-name",
        version: "2030.9.0",
        status: "ok",
        timestamp: new Date().toISOString(),
        futureField: true
      });
    },
    () => service().checkAll()
  );

  assert.deepEqual(requests.sort(), [
    `${services.jobs}/internal/v1/health/ready`,
    `${services.realtime}/internal/v1/health/ready`,
    `${services.seoData}/internal/v1/health/ready`
  ]);
  assert.deepEqual(
    result.map(({ name, status }) => ({ name, status })),
    [
      { name: "seo-data", status: "ok" },
      { name: "jobs-integrations", status: "ok" },
      { name: "realtime", status: "ok" }
    ]
  );
});

test("fails closed for degraded, malformed and non-success responses", async () => {
  const result = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.startsWith(services.seoData)) {
        return jsonResponse({
          status: "degraded",
          message: "secret downstream detail"
        });
      }
      if (url.startsWith(services.jobs)) {
        return new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return jsonResponse(
        { status: "ok", message: "secret maintenance detail" },
        503
      );
    },
    () => service().checkAll()
  );

  assert.deepEqual(
    result.map(({ name, status }) => ({ name, status })),
    [
      { name: "seo-data", status: "unavailable" },
      { name: "jobs-integrations", status: "unavailable" },
      { name: "realtime", status: "unavailable" }
    ]
  );
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(result[0]?.message, "Dependency readiness response invalid");
  assert.equal(result[1]?.message, "Dependency request failed");
  assert.equal(result[2]?.message, "HTTP 503");
});

test("rejects bodies where ready status is missing or nested", async () => {
  const bodies: readonly unknown[] = [
    null,
    [],
    { data: { status: "ok" } }
  ];
  let index = 0;
  const result = await withFetch(
    async () => jsonResponse(bodies[index++]),
    () => service().checkAll()
  );

  assert.equal(
    result.every(({ status }) => status === "unavailable"),
    true
  );
});

function service(): DependencyHealthService {
  return new DependencyHealthService({
    dependencyTimeoutMs: 500,
    services
  } as AppConfig);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function withFetch<T>(
  implementation: typeof fetch,
  operation: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await operation();
  } finally {
    globalThis.fetch = original;
  }
}
