import assert from "node:assert/strict";
import test from "node:test";
import {
  ArsenkinCredentialValidationConnector,
  arsenkinResult
} from "./arsenkin-credential-validation.connector.js";

test("validates Arsenkin through the read-only limits endpoint", async () => {
  let receivedUrl = "";
  let receivedAuthorization = "";
  const connector = new ArsenkinCredentialValidationConnector(
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
        status: "Success",
        limits_total: 1_000,
        limits_used: 25
      });
    }
  );

  assert.deepEqual(
    await connector.validate({ apiKey: "secret-token" }, 1_000),
    {
      ok: true,
      providerMeta: { limitsTotal: 1_000, limitsUsed: 25 }
    }
  );
  assert.equal(receivedUrl, "https://arsenkin.ru/api/tools/info");
  assert.equal(receivedAuthorization, "Bearer secret-token");
  assert.equal(receivedUrl.includes("secret-token"), false);
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
});
