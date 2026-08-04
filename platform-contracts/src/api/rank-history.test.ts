import assert from "node:assert/strict";
import test from "node:test";
import {
  rankHistoryMaxPageSize,
  redactRankHistoryItem,
  type InternalRankHistoryCollection,
  type InternalRankHistoryCursorV1,
  type InternalRankHistoryQuery,
  type RankHistoryItem,
  type RankHistoryQuery
} from "./rank-history.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  snapshotId: "01900000-0000-7000-8000-000000000004",
  keywordId: "01900000-0000-7000-8000-000000000005",
  contextId: "01900000-0000-7000-8000-000000000006",
  jobId: "01900000-0000-7000-8000-000000000007"
} as const;

test("public history query has a mandatory partition range and no tenant context", () => {
  const query = {
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    trackingContextId: ids.contextId,
    limit: rankHistoryMaxPageSize,
    cursor: "opaque-authenticated-cursor"
  } satisfies RankHistoryQuery;

  assert.deepEqual(Object.keys(query), [
    "observedFrom",
    "observedBefore",
    "trackingContextId",
    "limit",
    "cursor"
  ]);
  assert.equal("workspaceId" in query, false);
  assert.equal("projectId" in query, false);
  assert.equal("actorId" in query, false);
  assert.equal("offset" in query, false);
});

test("internal history route and cursor are tenant-bound keysets without offset", () => {
  const query = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    keywordId: ids.keywordId,
    limit: 50
  } satisfies InternalRankHistoryQuery;
  const cursor = {
    schemaVersion: "rank-history-cursor@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    filterHash: {
      algorithm: "SHA_256",
      value: "a".repeat(64)
    },
    observedAt: "2026-07-29T12:00:00.000Z",
    snapshotId: ids.snapshotId
  } satisfies InternalRankHistoryCursorV1;

  assert.equal(query.workspaceId, ids.workspaceId);
  assert.deepEqual(Object.keys(cursor), [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "filterHash",
    "observedAt",
    "snapshotId"
  ]);
  assert.equal("offset" in cursor, false);
  assert.equal("limit" in cursor, false);
  assert.equal("actorId" in cursor, false);
});

test("history item redaction keeps project data but drops internal provenance", () => {
  const unsafe = {
    snapshotId: ids.snapshotId,
    keywordId: ids.keywordId,
    trackingContextId: ids.contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-positions@1.0.0",
    observedAt: "2026-07-29T12:00:00.000Z",
    storedAt: "2026-07-29T12:00:01.000Z",
    jobId: ids.jobId,
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ],
    found: true,
    position: 7,
    rankingUrl: "https://project.example/page",
    normalizedRankingUrl: "https://project.example/page",
    title: "Result title",
    resultType: "ORGANIC",
    serpFeatures: [],
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    manifestId: "private-manifest",
    manifestEntryId: "private-entry",
    assignmentId: "private-assignment",
    providerRequestId: "private-provider-request",
    credentialId: "private-credential",
    rawProviderResponse: "private-provider-payload"
  } as const;

  const item = redactRankHistoryItem(unsafe);
  assert.deepEqual(item, {
    snapshotId: ids.snapshotId,
    keywordId: ids.keywordId,
    trackingContextId: ids.contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-positions@1.0.0",
    observedAt: "2026-07-29T12:00:00.000Z",
    storedAt: "2026-07-29T12:00:01.000Z",
    jobId: ids.jobId,
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ],
    found: true,
    position: 7,
    rankingUrl: "https://project.example/page",
    normalizedRankingUrl: "https://project.example/page",
    title: "Result title",
    resultType: "ORGANIC",
    serpFeatures: []
  });

  const serialized = JSON.stringify(item);
  for (const forbidden of [
    "workspaceId",
    "projectId",
    "manifestId",
    "manifestEntryId",
    "assignmentId",
    "providerRequestId",
    "credentialId",
    "rawProviderResponse",
    "private-provider-request",
    "private-provider-payload"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  assert.throws(
    () =>
      redactRankHistoryItem({
        ...unsafe,
        absolutePosition: 7
      }),
    /Invalid rank history item/u
  );
});

test("not-found history is exact and cannot carry ranking metadata", () => {
  const item = {
    snapshotId: ids.snapshotId,
    keywordId: ids.keywordId,
    trackingContextId: ids.contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-positions@1.0.0",
    observedAt: "2026-07-29T12:00:00.000Z",
    storedAt: "2026-07-29T12:00:01.000Z",
    jobId: ids.jobId,
    dataQualityFlags: [],
    found: false,
    position: null
  } as const satisfies RankHistoryItem;

  assert.deepEqual(redactRankHistoryItem(item), item);
  assert.throws(
    () =>
      redactRankHistoryItem({
        ...item,
        rankingUrl: "https://must-not-exist.example"
      } as unknown as RankHistoryItem),
    /Invalid rank history item/u
  );
  assert.throws(
    () =>
      redactRankHistoryItem({
        ...item,
        snapshotId:
          "0190000a-0000-7000-8000-000000000004".toUpperCase()
      }),
    /Invalid rank history item/u
  );
});

test("history accepts TOP-100 and rejects positions above the storage boundary", () => {
  const item = {
    snapshotId: ids.snapshotId,
    keywordId: ids.keywordId,
    trackingContextId: ids.contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-positions@2.0.0",
    observedAt: "2026-07-29T12:00:00.000Z",
    storedAt: "2026-07-29T12:00:01.000Z",
    jobId: ids.jobId,
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "TITLE_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ],
    found: true,
    position: 100,
    rankingUrl: "https://project.example/page",
    normalizedRankingUrl: "https://project.example/page",
    resultType: "ORGANIC",
    serpFeatures: []
  } as const satisfies RankHistoryItem;

  assert.equal(redactRankHistoryItem(item).position, 100);
  assert.throws(
    () => redactRankHistoryItem({ ...item, position: 101 }),
    /Invalid rank history item/u
  );
});

test("internal history collection carries scope only in its internal envelope", () => {
  const item = {
    snapshotId: ids.snapshotId,
    keywordId: ids.keywordId,
    trackingContextId: ids.contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-positions@1.0.0",
    observedAt: "2026-07-29T12:00:00.000Z",
    storedAt: "2026-07-29T12:00:01.000Z",
    jobId: ids.jobId,
    dataQualityFlags: [],
    found: false,
    position: null
  } as const satisfies RankHistoryItem;
  const collection = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    items: [item],
    page: {
      hasNext: true,
      nextCursor: "opaque-authenticated-cursor"
    }
  } satisfies InternalRankHistoryCollection;

  assert.equal(collection.items[0]?.snapshotId, ids.snapshotId);
  assert.equal("workspaceId" in collection.items[0]!, false);
  assert.equal("projectId" in collection.items[0]!, false);
});
