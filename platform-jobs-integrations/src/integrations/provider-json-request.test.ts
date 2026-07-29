import assert from "node:assert/strict";
import test from "node:test";
import {
  providerJsonRequest,
  ProviderTransportError
} from "./provider-json-request.js";

test("rejects oversized and malformed provider responses", async () => {
  await assert.rejects(
    providerJsonRequest(
      new URL("https://provider.example/limits"),
      {},
      1_000,
      async () =>
        new Response("{}", {
          headers: {
            "Content-Length": "1048577",
            "Content-Type": "application/json"
          }
        })
    ),
    ProviderTransportError
  );
  await assert.rejects(
    providerJsonRequest(
      new URL("https://provider.example/limits"),
      {},
      1_000,
      async () =>
        new Response("<html>not json</html>", {
          headers: { "Content-Type": "application/json" }
        })
    ),
    ProviderTransportError
  );
});

test("rejects non-JSON and streamed oversized provider responses", async () => {
  await assert.rejects(
    providerJsonRequest(
      new URL("https://provider.example/limits"),
      {},
      1_000,
      async () =>
        new Response("{}", {
          headers: { "Content-Type": "text/plain" }
        })
    ),
    ProviderTransportError
  );

  await assert.rejects(
    providerJsonRequest(
      new URL("https://provider.example/limits"),
      {},
      1_000,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1_048_577));
              controller.close();
            }
          }),
          { headers: { "Content-Type": "application/json" } }
        )
    ),
    ProviderTransportError
  );
});

test("preserves non-JSON error status and a bounded Retry-After hint", async () => {
  const unauthorized = await providerJsonRequest(
    new URL("https://provider.example/limits"),
    {},
    1_000,
    async () =>
      new Response("<html>Unauthorized</html>", {
        status: 401,
        headers: { "Content-Type": "text/html" }
      })
  );
  const rateLimited = await providerJsonRequest(
    new URL("https://provider.example/limits"),
    {},
    1_000,
    async () =>
      new Response("<html>Too Many Requests</html>", {
        status: 429,
        headers: {
          "Content-Type": "text/html",
          "Retry-After": "999999"
        }
      })
  );
  const unavailable = await providerJsonRequest(
    new URL("https://provider.example/limits"),
    {},
    1_000,
    async () => new Response(null, { status: 503 })
  );

  assert.deepEqual(unauthorized, {
    status: 401,
    value: undefined
  });
  assert.deepEqual(rateLimited, {
    status: 429,
    retryAfterSeconds: 3_600,
    value: undefined
  });
  assert.deepEqual(unavailable, {
    status: 503,
    value: undefined
  });
});

test("accepts a canonical HTTP-date Retry-After value", async () => {
  const now = Date.parse("2026-07-29T09:00:00.000Z");
  const retryAt = new Date(now + 90_000);

  const response = await providerJsonRequest(
    new URL("https://provider.example/limits"),
    {},
    1_000,
    async () =>
      new Response("", {
        status: 429,
        headers: {
          "Content-Type": "text/plain",
          "Retry-After": retryAt.toUTCString()
        }
      }),
    () => now
  );

  assert.equal(response.retryAfterSeconds, 90);
});
