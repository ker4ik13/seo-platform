import assert from "node:assert/strict";
import test from "node:test";
import { prepareRankRetry, rankRetryContextDraft } from "./rank-retry.ts";
import { BrowserApiError } from "./browser-api.ts";

const execution = { searchEngine: "YANDEX", countryCode: "RU", regionCode: "213", language: "ru", device: "DESKTOP", depth: 30, domainMatchRule: { mode: "EXACT_HOST" }, safeSearch: false, providerMappingVersion: "xmlstock-yandex-live@3" };
const job = { id: "job", workspaceId: "workspace", projectId: "project", credentialMode: "PLATFORM_PAID", provider: "XMLSTOCK", searchSource: "LIVE", status: "PARTIALLY_COMPLETED", result: { failedCount: "2", submitOutcomeUnknownCount: "0" } };
test("a new rank run excludes found, not-found and inactive rows; uses current versions without submitting", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url, options) => {
    assert.equal(options?.method, "GET"); calls.push(String(url));
    if (String(url).includes("keyword-groups")) return Response.json({ data: [] });
    return Response.json({ data: { jobId: "job", job, execution, contextName: "Настройки", counts: { foundCount: 1, notFoundCount: 1 }, rows: [
      { keywordId: "one", keyword: "Настройки", keywordVersion: 8, state: "PENDING" },
      { keywordId: "two", keyword: "Done", keywordVersion: 2, state: "NOT_FOUND" },
      { keywordId: "three", keyword: "Done", keywordVersion: 1, state: "FOUND" },
      { keywordId: "four", keyword: "Removed", keywordAvailable: false, state: "PENDING" }
    ], page: { hasNext: false } } });
  }) as typeof fetch;
  try {
    const draft = await prepareRankRetry("project", "job", new AbortController().signal);
    assert.deepEqual(draft.selections, [{ id: "one", version: 8, label: "Настройки" }]);
    assert.equal(calls.length, 2);
    const context = rankRetryContextDraft(draft.result);
    assert.equal(context.name, "Настройки");
    assert.equal(context.regionLabel, "Москва");
    assert.equal(context.depth, 30);
    assert.equal(context.scopeMode, "KEYWORDS");
    assert.equal(context.includeUntracked, true);
  } finally { globalThis.fetch = original; }
});
test("uncertain, empty, cross-project and changing rank scopes cannot turn into new paid runs", async () => {
  const original = globalThis.fetch;
  try {
    for (const [current, code] of [
      [{ ...job, result: { ...job.result, submitOutcomeUnknownCount: "1" } }, "PAID_OPERATION_REQUIRES_REVIEW"],
      [job, "NO_RETRYABLE_KEYWORDS"],
      [{ ...job, projectId: "foreign" }, "RETRY_SCOPE_CHANGED"]
    ] as const) {
      globalThis.fetch = async () => Response.json({ data: { jobId: "job", job: current, execution, counts: { foundCount: 0, notFoundCount: 0 }, rows: [], page: { hasNext: false } } });
      await assert.rejects(() => prepareRankRetry("project", "job", new AbortController().signal), error => error instanceof BrowserApiError && error.code === code);
    }
    let page = 0;
    globalThis.fetch = async () => Response.json({ data: { jobId: "job", job: { ...job, result: { ...job.result, failedCount: String(page++) } }, execution, counts: { foundCount: 0, notFoundCount: 0 }, rows: [], page: { hasNext: true, nextCursor: "499" } } });
    await assert.rejects(() => prepareRankRetry("project", "job", new AbortController().signal), error => error instanceof BrowserApiError && error.code === "RETRY_SCOPE_CHANGED");
  } finally { globalThis.fetch = original; }
});
