import assert from "node:assert/strict";
import test from "node:test";
import { prepareFrequencyRetry } from "./frequency-retry.ts";
import { BrowserApiError } from "./browser-api.ts";

const collection = { id: "job", projectId: "project", workspaceId: "workspace", provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID", requiresUsageReview: false, status: "FAILED_FINAL", version: 7, types: ["BASE"], regionCode: "225", device: "ALL" };
test("retry prepares only editable failed keywords using current versions and does not mutate the old job", async () => {
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    assert.equal(init?.method, "GET"); calls.push(String(url));
    if (String(url).includes("keyword-groups")) return Response.json({ data: [] });
    assert.match(String(url), /onlyFailed=true/u);
    return Response.json({ data: { collection, rows: [
      { keywordId: "retry", keyword: "Настройки", keywordVersion: 9, keywordAvailable: true, status: "FAILED_FINAL" },
      { keywordId: "done", keyword: "Already done", keywordVersion: 2, status: "COMPLETED" },
      { keywordId: "deleted", keyword: "", keywordAvailable: false, status: "FAILED_FINAL" }
    ], page: { hasNext: false } } });
  }) as typeof fetch;
  try {
    const result = await prepareFrequencyRetry("project", "job", new AbortController().signal);
    assert.deepEqual(result.selections, [{ id: "retry", version: 9, label: "Настройки" }]);
    assert.equal(calls.length, 2);
    assert.equal(calls.some(url => url.includes("retry-failed")), false);
  } finally { globalThis.fetch = original; }
});
test("uncertain charges and empty retry scopes never become a full-project launch", async () => {
  const original = globalThis.fetch;
  try {
    for (const pending of [true, undefined, false]) {
      globalThis.fetch = async () => Response.json({ data: { collection: { ...collection, requiresUsageReview: pending }, rows: [], page: { hasNext: false } } });
      await assert.rejects(() => prepareFrequencyRetry("project", "job", new AbortController().signal), error => error instanceof BrowserApiError && error.code === (pending === false ? "NO_RETRYABLE_KEYWORDS" : "PAID_OPERATION_REQUIRES_REVIEW"));
    }
  } finally { globalThis.fetch = original; }
});
test("a changed operation or repeated cursor invalidates the retry draft", async () => {
  const original = globalThis.fetch;
  try {
    let count = 0;
    globalThis.fetch = async () => Response.json({ data: { collection: { ...collection, version: count++ ? 8 : 7 }, rows: [], page: { hasNext: true, nextCursor: "499" } } });
    await assert.rejects(() => prepareFrequencyRetry("project", "job", new AbortController().signal), error => error instanceof BrowserApiError && error.code === "RETRY_SCOPE_CHANGED");
  } finally { globalThis.fetch = original; }
});
