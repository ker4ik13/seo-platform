import assert from "node:assert/strict";
import test from "node:test";
import {
  storedXmlStockOperationUsage,
  xmlStockOperationUsage,
  xmlStockPricingFromProviderMeta,
  xmlStockPricingMetadata,
  xmlStockUsageWithActual
} from "./xmlstock-pricing.js";

const observedAt = "2026-09-15T09:00:00.000Z";

test("derives the current XMLStock tariff from account-specific prices", () => {
  const metadata = xmlStockPricingMetadata({
    status: "ok",
    user: "private",
    urls: {
      yandex: { price: "27", method: { xml: "private-url" } },
      yandexlive: { price: "20" },
      google: { price: "20" },
      wordstat: { price: "23" }
    }
  });
  assert.deepEqual(metadata, {
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
  });
  assert.doesNotMatch(JSON.stringify(metadata), /private|method|url/iu);
});

test("freezes estimated and actual XMLStock cost in micro-rubles", () => {
  const pricing = xmlStockPricingFromProviderMeta({
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
  }, observedAt);
  const estimate = xmlStockOperationUsage(
    pricing,
    "GOOGLE_LIVE",
    100,
    100,
    observedAt
  );
  assert.equal(estimate?.unitPriceMicro, "25000");
  assert.deepEqual(estimate?.estimatedCostMicro, {
    minimum: "2500000",
    maximum: "2500000"
  });
  const completed = xmlStockUsageWithActual(estimate, 93, 95);
  assert.deepEqual(completed?.actualCostMicro, {
    minimum: "2325000",
    maximum: "2375000"
  });
  assert.deepEqual(storedXmlStockOperationUsage(completed), completed);
});
