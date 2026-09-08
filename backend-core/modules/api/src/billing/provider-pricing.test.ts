import assert from "node:assert/strict";
import test from "node:test";
import { customerChargeMinor, priceOperation, defaultProviderPricingPolicy } from "./provider-pricing.js";

test("prices for 50% margin, distinguishes it from a 50% markup, and rounds upward", () => {
  assert.equal(customerChargeMinor(1_000_000n, { targetMarginBps: 5000, paymentFeeBps: 0, taxReserveBps: 0, contingencyBps: 0 }), 200n);
  for (const cost of [1n, 25_000n, 1_000_000n, 299_999_999_999n]) {
    const chargeMicro = customerChargeMinor(cost) * 10_000n;
    const rates = defaultProviderPricingPolicy;
    const retained = 10_000 - rates.paymentFeeBps - rates.taxReserveBps - rates.contingencyBps;
    assert.ok(chargeMicro * BigInt(retained - rates.targetMarginBps) >= cost * 10_000n);
  }
  assert.throws(() => customerChargeMinor(1n, { targetMarginBps: 9000, paymentFeeBps: 2000, taxReserveBps: 0, contingencyBps: 0 }));
});
test("counts physical SERP pages and all frequency variants instead of billing one request per keyword", () => {
  const live = priceOperation({ provider: "XMLSTOCK", operation: "POSITIONS", keywordCount: 50_000, depth: 100, searchSource: "GOOGLE_LIVE" });
  const official = priceOperation({ provider: "XMLSTOCK", operation: "POSITIONS", keywordCount: 50_000, depth: 100, searchSource: "YANDEX_SEARCH_API" });
  assert.equal(live.providerUnitsMilli, "500000000");
  assert.equal(official.providerUnitsMilli, "50000000");
  const frequency = priceOperation({ provider: "XMLSTOCK", operation: "FREQUENCY", keywordCount: 50_000, frequencyVariantCount: 3 });
  assert.equal(frequency.providerUnitsMilli, "150000000");
});
test("keeps half-limit clustering arithmetic exact and rejects unsupported combinations", () => {
  assert.equal(priceOperation({ provider: "ARSENKIN", operation: "POSITIONS", keywordCount: 1, depth: 100, searchSource: "GOOGLE_LIVE" }).providerUnitsMilli, "5000");
  assert.equal(priceOperation({ provider: "ARSENKIN", operation: "POSITIONS", keywordCount: 1, depth: 50, searchSource: "GOOGLE_LIVE" }).providerUnitsMilli, "3000");
  assert.equal(priceOperation({ provider: "ARSENKIN", operation: "CLUSTERING", keywordCount: 3, frequencyVariantCount: 0 }).providerUnitsMilli, "4500");
  assert.equal(priceOperation({ provider: "ARSENKIN", operation: "CLUSTERING", keywordCount: 3, frequencyVariantCount: 3 }).providerUnitsMilli, "13500");
  assert.equal(priceOperation({ provider: "ARSENKIN", operation: "CLUSTERING", keywordCount: 3, frequencyVariantCount: 4 }).providerUnitsMilli, "16500");
  assert.throws(() => priceOperation({ provider: "XMLSTOCK", operation: "AI_ANSWER", keywordCount: 1 }));
  assert.throws(() => priceOperation({ provider: "XMLSTOCK", operation: "FREQUENCY", keywordCount: 1, frequencyVariantCount: 0 }));
  assert.throws(() => priceOperation({ provider: "ARSENKIN", operation: "POSITIONS", keywordCount: 300001 }));
});
