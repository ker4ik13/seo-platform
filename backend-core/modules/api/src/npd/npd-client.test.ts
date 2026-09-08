import assert from "node:assert/strict";
import test from "node:test";
import { NpdClient, npdDate, npdIncomeRequest } from "./npd-client.js";
import type { InternalNpdIssueMaterial } from "@seo-platform/contracts";
const material: InternalNpdIssueMaterial = { receiptId: "01900000-0000-7000-8000-000000000001", leaseToken: "01900000-0000-7000-8000-000000000002", amountMinor: "12345", paidAt: "2026-09-06T22:00:00Z", description: "Доступ к SEOньорите", buyerType: "INDIVIDUAL" };

test("creates exact NPD money/date/category fields without bypassing the income restriction", () => {
  const body = npdIncomeRequest(material);
  assert.equal(body.totalAmount, "123.45");
  assert.equal(body.operationTime, "2026-09-07T01:00:00.000+03:00");
  assert.equal(body.ignoreMaxTotalIncomeRestriction, false);
  assert.equal((body.client as { incomeType: string }).incomeType, "FROM_INDIVIDUAL");
  const company = npdIncomeRequest({ ...material, buyerType: "LEGAL_ENTITY", buyerName: "Тестовая организация", buyerInn: "7700000000" });
  assert.equal((company.client as { incomeType: string }).incomeType, "FROM_LEGAL_ENTITY");
  assert.throws(() => npdIncomeRequest({ ...material, buyerType: "LEGAL_ENTITY" }));
  assert.throws(() => npdIncomeRequest({ ...material, amountMinor: "0" }));
  assert.throws(() => npdDate("invalid"));
});
test("does not issue before authentication and never exposes raw provider error details", async () => {
  const client = new NpdClient({ inn: "123456789012", password: "unit-test-password", deviceId: "npd-unit-test-device" });
  await assert.rejects(() => client.issue(material), /NPD_SESSION_EXPIRED/u);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "private-provider-payload" }), { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(() => client.prepare(), error => error instanceof Error && error.message === "NPD_AUTH_FAILED" && !JSON.stringify(error).includes("private-provider-payload"));
  } finally { globalThis.fetch = oldFetch; }
});
