import assert from "node:assert/strict";
import test from "node:test";
import { providerAccountPresentation } from "./provider-balance.service.js";
const base = { id: "01900000-0000-7000-8000-000000000001", slot: 1, enabled: true, checkedAt: new Date().toISOString(), errorCode: null };
test("uses integer money for the 500 RUB threshold and labels Arsenkin's limit valuation", () => {
  assert.equal(providerAccountPresentation({ ...base, provider: "XMLSTOCK", unit: "RUB", remaining: "499.999" }).lowBalance, true);
  assert.equal(providerAccountPresentation({ ...base, provider: "XMLSTOCK", unit: "RUB", remaining: "500" }).lowBalance, false);
  const arsenkin = providerAccountPresentation({ ...base, provider: "ARSENKIN", unit: "ARSENKIN_LIMITS", remaining: "20000" });
  assert.equal(arsenkin.estimatedBalanceMinor, 58590);
  assert.equal(arsenkin.lowBalance, false);
  assert.equal(providerAccountPresentation({ ...base, provider: "XMLSTOCK", unit: "RUB", remaining: null, checkedAt: null }).stale, true);
});
