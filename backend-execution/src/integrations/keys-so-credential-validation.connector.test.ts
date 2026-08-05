import assert from "node:assert/strict";
import test from "node:test";
import {
  KeysSoCredentialValidationConnector,
  keysSoResult
} from "./keys-so-credential-validation.connector.js";

test("validates Keys.so through the read-only limits endpoint", async () => {
  let receivedUrl = "";
  let receivedToken = "";
  const connector = new KeysSoCredentialValidationConnector(
    async (input, init) => {
      receivedUrl = String(input);
      receivedToken = String(
        new Headers(init?.headers).get("x-keyso-token")
      );
      assert.equal(init?.redirect, "error");
      return Response.json({
        apiRequest: { limit: 25_000, usedLimit: 40 }
      });
    }
  );

  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: true,
      providerMeta: {
        apiRequest: { limit: 25_000, usedLimit: 40 }
      }
    }
  );
  assert.equal(receivedUrl, "https://api.keys.so/limits/all");
  assert.equal(receivedToken, "secret-token");
  assert.equal(receivedUrl.includes("secret-token"), false);
});

test("normalizes Keys.so authentication and transient errors", () => {
  assert.deepEqual(keysSoResult(403, {}), {
    ok: false,
    errorCode: "INVALID_CREDENTIAL",
    retryable: false,
    credentialStatus: "INVALID"
  });
  assert.deepEqual(keysSoResult(500, {}), {
    ok: false,
    errorCode: "PROVIDER_UNAVAILABLE",
    retryable: true,
    credentialStatus: "DEGRADED"
  });
  assert.deepEqual(keysSoResult(200, {}), {
    ok: false,
    errorCode: "PROVIDER_UNAVAILABLE",
    retryable: true,
    credentialStatus: "DEGRADED"
  });
  assert.deepEqual(
    keysSoResult(200, { error: { code: 401 } }),
    {
      ok: false,
      errorCode: "INVALID_CREDENTIAL",
      retryable: false,
      credentialStatus: "INVALID"
    }
  );
});

test("preserves a bounded provider Retry-After hint", async () => {
  const connector = new KeysSoCredentialValidationConnector(
    async () =>
      Response.json(
        { error: { code: 429 } },
        {
          status: 429,
          headers: { "Retry-After": "30" }
        }
      )
  );

  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: false,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 30,
      credentialStatus: "RATE_LIMITED"
    }
  );
});

test("classifies bounded HTML or empty error responses by HTTP status", async () => {
  const responses = [
    new Response("<html>Unauthorized</html>", {
      status: 401,
      headers: { "Content-Type": "text/html" }
    }),
    new Response("<html>Too Many Requests</html>", {
      status: 429,
      headers: {
        "Content-Type": "text/html",
        "Retry-After": "30"
      }
    }),
    new Response(null, { status: 503 })
  ];
  const connector = new KeysSoCredentialValidationConnector(
    async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected provider request");
      return response;
    }
  );

  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: false,
      errorCode: "INVALID_CREDENTIAL",
      retryable: false,
      credentialStatus: "INVALID"
    }
  );
  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: false,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 30,
      credentialStatus: "RATE_LIMITED"
    }
  );
  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: false,
      errorCode: "PROVIDER_UNAVAILABLE",
      retryable: true,
      credentialStatus: "DEGRADED"
    }
  );
});
