import assert from "node:assert/strict";
import test from "node:test";
import type { ArsenkinHttpRateLimitGate } from "./arsenkin-http-rate-limiter.js";
import {
  ArsenkinCredentialValidationConnector,
  arsenkinResult
} from "./arsenkin-credential-validation.connector.js";

test("validates Arsenkin through the read-only limits endpoint", async () => {
  let receivedUrl = "";
  let receivedAuthorization = "";
  const connector = new ArsenkinCredentialValidationConnector(
    allowAll(),
    async (input, init) => {
      receivedUrl = String(input);
      receivedAuthorization = String(
        new Headers(init?.headers).get("authorization")
      );
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        query: "limits"
      });
      return Response.json({
        limits_total: 1_000
      });
    }
  );

  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: true,
      providerMeta: { limitsTotal: 1_000 }
    }
  );
  assert.equal(receivedUrl, "https://arsenkin.ru/api/tools/info");
  assert.equal(receivedAuthorization, "Bearer secret-token");
  assert.equal(receivedUrl.includes("secret-token"), false);
});

test("rate limits validation before provider bytes are sent", async () => {
  let providerCalls = 0;
  const connector = new ArsenkinCredentialValidationConnector(
    {
      async tryAcquire() {
        return { allowed: false, retryAfterSeconds: 9 };
      }
    },
    async () => {
      providerCalls += 1;
      return Response.json({ limits_total: 1_000 });
    }
  );

  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: false,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 9,
      credentialStatus: "RATE_LIMITED"
    }
  );
  assert.equal(providerCalls, 0);
});

test("normalizes Arsenkin authentication and rate limit errors", () => {
  assert.deepEqual(arsenkinResult(401, {}), {
    ok: false,
    errorCode: "INVALID_CREDENTIAL",
    retryable: false,
    credentialStatus: "INVALID"
  });
  assert.deepEqual(
    arsenkinResult(200, {
      status: "Error",
      code: "429",
      error: "Too Many Requests"
    }),
    {
      ok: false,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      credentialStatus: "RATE_LIMITED"
    }
  );
  assert.deepEqual(arsenkinResult(200, {}), {
    ok: false,
    errorCode: "PROVIDER_UNAVAILABLE",
    retryable: true,
    credentialStatus: "DEGRADED"
  });
  assert.deepEqual(
    arsenkinResult(200, {
      status: "Success",
      limits_total: 5_000
    }),
    {
      ok: true,
      providerMeta: { limitsTotal: 5_000 }
    }
  );
  assert.deepEqual(
    arsenkinResult(200, { status: "Success" }),
    {
      ok: false,
      errorCode: "PROVIDER_UNAVAILABLE",
      retryable: true,
      credentialStatus: "DEGRADED"
    }
  );
});

function allowAll(): ArsenkinHttpRateLimitGate {
  return {
    async tryAcquire() {
      return { allowed: true };
    }
  };
}
