import assert from "node:assert/strict";
import test from "node:test";
import { domainEventTypes } from "./catalog.js";
import { rankCheckCompletedEventDataV1 } from "./rankings.js";

test("rank check completion has a stable versioned event name", () => {
  assert.equal(
    domainEventTypes.rankCheckCompleted,
    "seo.rank-check.completed.v1"
  );
});

test("rank check completion event data is exact, ISO and redacted", () => {
  const payload = rankCheckCompletedEventDataV1({
    jobId: "01900000-0000-7000-8000-000000000001",
    manifestId: "01900000-0000-7000-8000-000000000002",
    workspaceId: "01900000-0000-7000-8000-000000000003",
    projectId: "01900000-0000-7000-8000-000000000004",
    trackingContextId: "01900000-0000-7000-8000-000000000005",
    configurationVersion: 3,
    status: "PARTIALLY_COMPLETED",
    pairCount: "10",
    persistedCount: "9",
    foundCount: "7",
    notFoundCount: "2",
    completedAt: new Date("2026-07-29T15:30:45.123Z"),
    credentialId: "private-credential",
    bindingId: "private-binding",
    keywordId: "private-keyword-id",
    keywordText: "private keyword",
    rankingUrl: "https://private-result.example",
    providerRequestId: "private-provider-request",
    rawProviderResponse: "private-provider-payload"
  } as {
    jobId: string;
    manifestId: string;
    workspaceId: string;
    projectId: string;
    trackingContextId: string;
    configurationVersion: number;
    status: "PARTIALLY_COMPLETED";
    pairCount: string;
    persistedCount: string;
    foundCount: string;
    notFoundCount: string;
    completedAt: Date;
    credentialId: string;
    bindingId: string;
    keywordId: string;
    keywordText: string;
    rankingUrl: string;
    providerRequestId: string;
    rawProviderResponse: string;
  });

  assert.deepEqual(payload, {
    jobId: "01900000-0000-7000-8000-000000000001",
    manifestId: "01900000-0000-7000-8000-000000000002",
    workspaceId: "01900000-0000-7000-8000-000000000003",
    projectId: "01900000-0000-7000-8000-000000000004",
    trackingContextId: "01900000-0000-7000-8000-000000000005",
    configurationVersion: 3,
    status: "PARTIALLY_COMPLETED",
    pairCount: "10",
    persistedCount: "9",
    foundCount: "7",
    notFoundCount: "2",
    completedAt: "2026-07-29T15:30:45.123Z"
  });
  assert.deepEqual(Object.keys(payload), [
    "jobId",
    "manifestId",
    "workspaceId",
    "projectId",
    "trackingContextId",
    "configurationVersion",
    "status",
    "pairCount",
    "persistedCount",
    "foundCount",
    "notFoundCount",
    "completedAt"
  ]);

  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "credentialId",
    "bindingId",
    "keywordId",
    "keywordText",
    "rankingUrl",
    "providerRequestId",
    "rawProviderResponse",
    "private-credential",
    "private-binding",
    "private keyword",
    "private-result.example",
    "private-provider-request",
    "private-provider-payload"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("rank check completion rejects inconsistent terminal counts", () => {
  const base = {
    jobId: "01900000-0000-7000-8000-000000000001",
    manifestId: "01900000-0000-7000-8000-000000000002",
    workspaceId: "01900000-0000-7000-8000-000000000003",
    projectId: "01900000-0000-7000-8000-000000000004",
    trackingContextId: "01900000-0000-7000-8000-000000000005",
    configurationVersion: 3,
    foundCount: "4",
    notFoundCount: "5",
    completedAt: new Date("2026-07-29T15:30:45.123Z")
  } as const;

  for (const input of [
    {
      ...base,
      status: "COMPLETED",
      pairCount: "10",
      persistedCount: "9"
    },
    {
      ...base,
      status: "PARTIALLY_COMPLETED",
      pairCount: "9",
      persistedCount: "9"
    },
    {
      ...base,
      status: "PARTIALLY_COMPLETED",
      pairCount: "10",
      persistedCount: "8"
    },
    {
      ...base,
      status: "COMPLETED",
      pairCount: "01",
      persistedCount: "9"
    }
  ] as const) {
    assert.throws(
      () => rankCheckCompletedEventDataV1(input),
      /Invalid rank check completion counts/u
    );
  }

  assert.throws(
    () =>
      rankCheckCompletedEventDataV1({
        ...base,
        status: "ACTION_REQUIRED",
        pairCount: "9",
        persistedCount: "9"
      } as unknown as Parameters<typeof rankCheckCompletedEventDataV1>[0]),
    /Invalid rank check completion status/u
  );
});
