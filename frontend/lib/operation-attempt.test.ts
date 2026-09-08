import assert from "node:assert/strict";
import test from "node:test";
import { browserApiRequest, BrowserApiError } from "./browser-api.ts";
import { prepareOperationAttempt } from "./operation-attempt.ts";
import { registerOperationConfirmation } from "./operation-confirmation.ts";

const projectId = "01900000-0000-7000-8000-000000000001", workspaceId = "01900000-0000-7000-8000-000000000002";
const path = `/app/api/projects/${projectId}/frequency-collections`, body = { items: [{ id: projectId, version: 1 }], types: ["BASE"] };
const quote = { id: "01900000-0000-7000-8000-000000000003", workspaceId, projectId, kind: "FREQUENCY_COLLECTION", provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID", currency: "RUB", maximumChargeMinor: 100, quantity: 1, affordable: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), priceBookVersion: "test" };
function browser() {
  const original = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent() {} } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "seo_csrf=fixture" } });
  return () => { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}
test("lost create response reuses the exact approved price and idempotency key without a second estimate or consent", async () => {
  const restore = browser(), originalFetch = globalThis.fetch;
  const creates: { key: string | null; quoteId: string | null }[] = [];
  let estimates = 0, confirmations = 0;
  const unregister = registerOperationConfirmation(async request => { confirmations++; return request.quote; });
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("operation-estimates")) { estimates++; return Response.json({ data: quote }); }
    const headers = new Headers(init?.headers); creates.push({ key: headers.get("idempotency-key"), quoteId: headers.get("x-operation-estimate-id") });
    if (creates.length === 1) throw new TypeError("Response lost after server committed the job");
    return Response.json({ data: { id: "original-job" } });
  }) as typeof fetch;
  try {
    let attempt = prepareOperationAttempt(undefined, path, body, "source", "frequency");
    await assert.rejects(() => browserApiRequest(path, { method: "POST", body, operationAttempt: attempt }));
    attempt = prepareOperationAttempt(attempt, path, structuredClone(body), "source", "frequency");
    assert.deepEqual(await browserApiRequest(path, { method: "POST", body, operationAttempt: attempt }), { id: "original-job" });
    assert.equal(estimates, 1); assert.equal(confirmations, 1); assert.equal(creates.length, 2); assert.deepEqual(creates[0], creates[1]);
    assert.equal(creates[0]?.quoteId, quote.id);
    const edited = prepareOperationAttempt(attempt, path, { ...body, types: ["EXACT"] }, "source", "frequency");
    assert.notEqual(edited.key, attempt.key); assert.equal(edited.quoteId, undefined);
    assert.notEqual(prepareOperationAttempt(attempt, path, body, "another-source", "frequency").key, attempt.key);
  } finally { unregister(); globalThis.fetch = originalFetch; restore(); }
});
test("cancel never creates a paid job; an explicitly stale estimate allows a newly confirmed attempt", async () => {
  const restore = browser(), originalFetch = globalThis.fetch;
  let confirmed = false, created = 0;
  const unregister = registerOperationConfirmation(async request => confirmed ? request.quote : null);
  globalThis.fetch = async url => String(url).endsWith("operation-estimates") ? Response.json({ data: quote }) : (created++, Response.json({ error: { code: "ESTIMATE_STALE", message: "Expired" } }, { status: 409 }));
  try {
    const attempt = prepareOperationAttempt(undefined, path, body, "source", "frequency");
    await assert.rejects(() => browserApiRequest(path, { method: "POST", body, operationAttempt: attempt }), error => error instanceof BrowserApiError && error.code === "OPERATION_CANCELLED");
    assert.equal(created, 0); assert.equal(attempt.quoteId, undefined);
    confirmed = true;
    await assert.rejects(() => browserApiRequest(path, { method: "POST", body, operationAttempt: attempt }));
    const fresh = prepareOperationAttempt(attempt, path, body, "source", "frequency");
    assert.notEqual(fresh.key, attempt.key); assert.equal(fresh.quoteId, undefined);
  } finally { unregister(); globalThis.fetch = originalFetch; restore(); }
});
