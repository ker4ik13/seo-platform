import assert from "node:assert/strict";
import test from "node:test";
import {
  XmlStockCredentialValidationConnector,
  xmlStockAccountValidationResult,
  xmlStockStatusInfoValidationResult,
  xmlStockUserInfoValidationResult,
  xmlStockValidationResult
} from "./xmlstock-credential-validation.connector.js";

test("validates XMLStock against the read-only region catalog", async () => {
  let received: URL | undefined;
  const connector = new XmlStockCredentialValidationConnector(
    async (input, init) => {
      received = new URL(String(input));
      assert.equal(init?.redirect, "error");
      if (received.pathname === "/api/" && received.searchParams.get("info") === "user") {
        return Response.json({
          status: "ok",
          urls: {
            yandex: { price: "27", method: { xml: "secret-bearing-url" } },
            yandexlive: { price: "20" },
            google: { price: "20" },
            wordstat: { price: "23" }
          }
        });
      }
      if (received.pathname === "/api/" && received.searchParams.get("info") === "status") {
        return Response.json({
          "google-queries": 900,
          "yandex-live-queries": 800,
          "yandex-live-turbo-queries": 700,
          "yandex-xml-queries": 600,
          "google-load": 71,
          "yandex-live-load": 33
        });
      }
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
        xmlStockPricing: {
          tariffCode: "OPTIMAL",
          currency: "RUB",
          priceUnit: "PER_1000_REQUESTS",
          pricesPerThousand: {
            YANDEX_SEARCH_API: "27",
            YANDEX_LIVE: "20",
            YANDEX_TURBO: "30",
            GOOGLE_LIVE: "20",
            WORDSTAT: "23"
          }
        },
        xmlStockStatus: {
          availableRequests: {
            GOOGLE_LIVE: 900,
            YANDEX_LIVE: 800,
            YANDEX_TURBO: 700,
            YANDEX_SEARCH_API: 600
          },
          loadPercent: { GOOGLE_LIVE: 71, YANDEX_LIVE: 33 }
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

test("normalizes account-specific XMLStock rates without provider URLs", () => {
  assert.deepEqual(
    xmlStockUserInfoValidationResult(200, {
      status: "ok",
      user: "private-account",
      urls: {
        yandex: { price: "28", method: { xml: "private-url" } },
        yandexlive: { price: "25", method: { xml: "private-url" } },
        google: { price: "25", method: { xml: "private-url" } },
        wordstat: { price: "25", method: { json: "private-url" } }
      }
    }),
    {
      ok: true,
      providerMeta: {
        xmlStockPricing: {
          tariffCode: "BASIC",
          currency: "RUB",
          priceUnit: "PER_1000_REQUESTS",
          pricesPerThousand: {
            YANDEX_SEARCH_API: "28",
            YANDEX_LIVE: "25",
            YANDEX_TURBO: "35",
            GOOGLE_LIVE: "25",
            WORDSTAT: "25"
          }
        }
      }
    }
  );
});

test("normalizes XMLStock status capacity and rejects invalid load", () => {
  assert.equal(
    xmlStockStatusInfoValidationResult(200, {
      "google-queries": 1,
      "yandex-live-queries": 2,
      "yandex-live-turbo-queries": 3,
      "yandex-xml-queries": 4,
      "google-load": 101,
      "yandex-live-load": 20
    }).ok,
    false
  );
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
