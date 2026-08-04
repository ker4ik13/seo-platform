import assert from "node:assert/strict";
import test from "node:test";
import type { RankHistoryItem } from "@seo-platform/contracts";
import { BrowserApiError } from "./browser-api.ts";
import {
  defaultRankHistoryDateSelection,
  mergeRankHistoryItems,
  parseRankHistoryCollection,
  parseRankHistoryItem,
  rankHistoryApiPath,
  rankHistoryRangeFromDates,
  rankHistoryReturnTo
} from "./rank-history.ts";

const ids = {
  keywordId: "01900000-0000-7000-8000-000000000101",
  contextId: "01900000-0000-7000-8000-000000000102",
  jobId: "01900000-0000-7000-8000-000000000103"
} as const;

test("builds the default 30-day UTC selection and an exclusive upper bound", () => {
  assert.deepEqual(
    defaultRankHistoryDateSelection(
      new Date("2026-07-29T23:59:59.999Z")
    ),
    {
      fromDate: "2026-06-30",
      toDate: "2026-07-29"
    }
  );
  assert.deepEqual(
    rankHistoryRangeFromDates("2026-12-30", "2026-12-31"),
    {
      observedFrom: "2026-12-30T00:00:00.000Z",
      observedBefore: "2027-01-01T00:00:00.000Z"
    }
  );
  assert.throws(() =>
    rankHistoryRangeFromDates("2026-02-30", "2026-03-01")
  );
  assert.throws(() =>
    rankHistoryRangeFromDates("2026-07-30", "2026-07-29")
  );
});

test("builds only the project-scoped collection path and encoded public filters", () => {
  const path = rankHistoryApiPath("project/id", {
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    trackingContextId: ids.contextId,
    keywordId: ids.keywordId,
    limit: 50,
    cursor: "opaque_cursor"
  });
  const url = new URL(path, "https://web.example");
  assert.equal(url.pathname, "/app/api/projects/project%2Fid/rank-history");
  assert.deepEqual(
    Object.fromEntries(url.searchParams),
    {
      observedFrom: "2026-07-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      limit: "50",
      trackingContextId: ids.contextId,
      keywordId: ids.keywordId,
      cursor: "opaque_cursor"
    }
  );
  assert.equal(rankHistoryReturnTo("project/id"), "/app/semantics");
});

test("redacts unknown private fields and rejects contradictory history rows", () => {
  const item = historyItem(
    "01900000-0000-7000-8000-000000000109",
    "2026-07-29T12:00:00.000Z"
  );
  const parsed = parseRankHistoryItem({
    ...item,
    workspaceId: "private-workspace",
    credentialId: "private-credential",
    providerRequestId: "private-request",
    rawProviderPayload: { token: "must-not-survive" }
  });
  assert.deepEqual(parsed, item);
  const serialized = JSON.stringify(parsed);
  for (const privateValue of [
    "workspaceId",
    "credentialId",
    "providerRequestId",
    "rawProviderPayload",
    "must-not-survive"
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.throws(
    () =>
      parseRankHistoryItem({
        ...item,
        rankingUrl: "https://must-not-exist.example"
      }),
    invalidResponse
  );
});

test("requires a coherent cursor page and strict descending item order", () => {
  const newest = historyItem(
    "01900000-0000-7000-8000-000000000109",
    "2026-07-29T12:00:00.000Z"
  );
  const sameTimeLowerId = historyItem(
    "01900000-0000-7000-8000-000000000108",
    "2026-07-29T12:00:00.000Z"
  );
  const older = historyItem(
    "01900000-0000-7000-8000-000000000107",
    "2026-07-28T12:00:00.000Z"
  );
  assert.deepEqual(
    parseRankHistoryCollection({
      data: [newest, sameTimeLowerId, older],
      page: {
        hasNext: true,
        nextCursor: "opaque-next-cursor"
      }
    }).data,
    [newest, sameTimeLowerId, older]
  );
  assert.throws(
    () =>
      parseRankHistoryCollection({
        data: [sameTimeLowerId, newest],
        page: { hasNext: false }
      }),
    invalidResponse
  );
  assert.throws(
    () =>
      parseRankHistoryCollection({
        data: [newest],
        page: { hasNext: true }
      }),
    invalidResponse
  );
  assert.throws(
    () =>
      parseRankHistoryCollection({
        data: [newest],
        page: {
          hasNext: false,
          nextCursor: "unexpected-cursor"
        }
      }),
    invalidResponse
  );
});

test("merges cursor pages without duplicates or keyset boundary overlap", () => {
  const newest = historyItem(
    "01900000-0000-7000-8000-000000000109",
    "2026-07-29T12:00:00.000Z"
  );
  const middle = historyItem(
    "01900000-0000-7000-8000-000000000108",
    "2026-07-28T12:00:00.000Z"
  );
  const oldest = historyItem(
    "01900000-0000-7000-8000-000000000107",
    "2026-07-27T12:00:00.000Z"
  );
  assert.deepEqual(
    mergeRankHistoryItems([newest], [middle, oldest]),
    [newest, middle, oldest]
  );
  assert.throws(
    () => mergeRankHistoryItems([newest, middle], [middle, oldest]),
    invalidResponse
  );
  assert.throws(
    () => mergeRankHistoryItems([middle], [newest]),
    invalidResponse
  );
});

function historyItem(
  snapshotId: string,
  observedAt: string
): RankHistoryItem {
  return {
    snapshotId,
    keywordId: ids.keywordId,
    trackingContextId: ids.contextId,
    configurationVersion: 1,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin.positions.v1",
    observedAt,
    storedAt: observedAt,
    jobId: ids.jobId,
    dataQualityFlags: [],
    found: false,
    position: null
  };
}

function invalidResponse(error: unknown): boolean {
  return (
    error instanceof BrowserApiError &&
    error.status === 502 &&
    error.code === "INVALID_RESPONSE"
  );
}
