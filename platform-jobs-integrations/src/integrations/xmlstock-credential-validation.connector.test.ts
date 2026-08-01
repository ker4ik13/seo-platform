import assert from "node:assert/strict";
import test from "node:test";
import {
  XmlStockCredentialValidationConnector,
  xmlStockValidationResult
} from "./xmlstock-credential-validation.connector.js";

test("validates XMLStock against the read-only region catalog", async () => {
  let received: URL | undefined;
  const connector = new XmlStockCredentialValidationConnector(
    async (input, init) => {
      received = new URL(String(input));
      assert.equal(init?.redirect, "error");
      return Response.json({ regionsTree: [{ id: 225, name: "Россия" }] });
    }
  );
  assert.deepEqual(
    await connector.validate(
      { apiKey: "secret-key", accountIdentifier: "12345" },
      1_000
    ),
    {
      ok: true,
      providerMeta: { wordstat: true, regionCatalogAvailable: true }
    }
  );
  assert.equal(received?.origin, "https://xmlstock.com");
  assert.equal(received?.searchParams.get("regionsTree"), "1");
  assert.equal(received?.searchParams.get("user"), "12345");
  assert.equal(received?.searchParams.get("key"), "secret-key");
});

test("normalizes XMLStock JSON error codes returned with HTTP 200", () => {
  assert.deepEqual(xmlStockValidationResult(200, { error: { code: -34 } }), {
    ok: false,
    errorCode: "INVALID_CREDENTIAL",
    retryable: false,
    credentialStatus: "INVALID"
  });
  assert.deepEqual(xmlStockValidationResult(200, { error: 55 }), {
    ok: false,
    errorCode: "PROVIDER_RATE_LIMITED",
    retryable: true,
    credentialStatus: "RATE_LIMITED"
  });
});
