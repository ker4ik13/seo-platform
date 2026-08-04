import assert from "node:assert/strict";
import test from "node:test";
import {
  XmlStockCredentialValidationConnector,
  xmlStockAccountValidationResult,
  xmlStockValidationResult
} from "./xmlstock-credential-validation.connector.js";

test("validates XMLStock against the read-only region catalog", async () => {
  let received: URL | undefined;
  const connector = new XmlStockCredentialValidationConnector(
    async (input, init) => {
      received = new URL(String(input));
      assert.equal(init?.redirect, "error");
      return received.pathname === "/api/"
        ? Response.json({
            limits: 120,
            "limits-freeze": 5,
            "outgo-month": 18,
            "outgo-day": 3,
            balance: 27.39,
            "balance-freeze": 1.5,
            days: 14
          })
        : Response.json({ regions: [{ id: 225, name: "Россия" }] });
    }
  );
  assert.deepEqual(
    await connector.validate(
      { apiKey: "secret-key", accountIdentifier: "12345" },
      1_000
    ),
    {
      ok: true,
      providerMeta: {
        account: {
          requestLimit: 120,
          frozenRequestLimit: 5,
          usedMonth: 18,
          usedToday: 3,
          balance: "27.39",
          frozenBalance: "1.5",
          tariffDaysRemaining: 14
        },
        wordstat: true,
        regionCatalogAvailable: true
      }
    }
  );
  assert.equal(received?.origin, "https://xmlstock.com");
  assert.equal(received?.searchParams.get("pagetype"), "regionsTree");
  assert.equal(received?.searchParams.has("query"), false);
  assert.equal(received?.searchParams.get("user"), "12345");
  assert.equal(received?.searchParams.get("key"), "secret-key");
});

test("normalizes XMLStock account quota and balance", () => {
  assert.deepEqual(
    xmlStockAccountValidationResult(200, {
      limits: "200",
      "limits-freeze": 0,
      "outgo-month": 11,
      "outgo-day": "2",
      balance: "42.50",
      "balance-freeze": 0,
      days: 30
    }),
    {
      ok: true,
      providerMeta: {
        account: {
          requestLimit: 200,
          frozenRequestLimit: 0,
          usedMonth: 11,
          usedToday: 2,
          balance: "42.50",
          frozenBalance: "0",
          tariffDaysRemaining: 30
        }
      }
    }
  );
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
