import assert from "node:assert/strict";
import test from "node:test";
import type {
  RankHistoryQuery
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import { rankHistoryPage } from "./rank-history-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const keywordId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";
const firstSnapshotId =
  "01900000-0000-7000-8000-000000000008";
const secondSnapshotId =
  "01900000-0000-7000-8000-000000000007";

test("validates scope and redacts private rank-history provenance", () => {
  const result = rankHistoryPage(
    payload([foundItem()]),
    workspaceId,
    projectId,
    query()
  );

  assert.deepEqual(result.page, { hasNext: false });
  assert.equal(result.data[0]?.snapshotId, firstSnapshotId);
  assert.equal(result.data[0]?.siteResults?.length, 2);
  assert.equal(result.data[0]?.siteResults?.[0]?.title, "Other page");
  const serialized = JSON.stringify(result.data[0]);
  for (const privateField of [
    "workspaceId",
    "projectId",
    "manifestId",
    "credentialId",
    "rawProviderResponse"
  ]) {
    assert.equal(serialized.includes(privateField), false);
  }
});

test("accepts only a coherent bounded next page", () => {
  const nextCursor = "eyJjdXJzb3IiOiJuZXh0In0";
  const result = rankHistoryPage(
    payload(
      [foundItem(), notFoundItem()],
      { hasNext: true, nextCursor }
    ),
    workspaceId,
    projectId,
    query({ limit: 2 })
  );

  assert.deepEqual(result.page, { hasNext: true, nextCursor });
  assert.deepEqual(
    result.data.map(({ snapshotId }) => snapshotId),
    [firstSnapshotId, secondSnapshotId]
  );
});

test("rejects cross-scope, unfiltered, unordered and duplicate rows", () => {
  const invalidPayloads = [
    payload([foundItem()], undefined, {
      workspaceId:
        "01900000-0000-7000-8000-000000000099"
    }),
    payload([
      {
        ...foundItem(),
        trackingContextId:
          "01900000-0000-7000-8000-000000000099"
      }
    ]),
    payload([
      {
        ...foundItem(),
        observedAt: "2026-08-01T00:00:00.000Z"
      }
    ]),
    payload([notFoundItem(), foundItem()]),
    payload([foundItem(), { ...notFoundItem(), snapshotId: firstSnapshotId }])
  ];

  for (const candidate of invalidPayloads) {
    assert.throws(
      () =>
        rankHistoryPage(
          candidate,
          workspaceId,
          projectId,
          query({ limit: 2 })
        ),
      DomainError
    );
  }
});

test("rejects over-limit and incoherent cursor pages", () => {
  const nextCursor = "eyJjdXJzb3IiOiJuZXh0In0";
  const currentCursor = "eyJjdXJzb3IiOiJjdXJyZW50In0";
  const cases: readonly {
    readonly value: unknown;
    readonly query?: RankHistoryQuery;
  }[] = [
    {
      value: payload([foundItem(), notFoundItem()]),
      query: query({ limit: 1 })
    },
    {
      value: payload([foundItem()], { hasNext: true }),
      query: query({ limit: 1 })
    },
    {
      value: payload(
        [foundItem()],
        { hasNext: false, nextCursor }
      ),
      query: query({ limit: 1 })
    },
    {
      value: payload(
        [foundItem()],
        { hasNext: true, nextCursor }
      ),
      query: query({ limit: 2 })
    },
    {
      value: payload(
        [foundItem()],
        { hasNext: true, nextCursor: currentCursor }
      ),
      query: query({ limit: 1, cursor: currentCursor })
    }
  ];

  for (const candidate of cases) {
    assert.throws(
      () =>
        rankHistoryPage(
          candidate.value,
          workspaceId,
          projectId,
          candidate.query ?? query()
        ),
      DomainError
    );
  }
});

function query(
  overrides: Partial<RankHistoryQuery> = {}
): RankHistoryQuery {
  return {
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    trackingContextId: contextId,
    keywordId,
    limit: 100,
    ...overrides
  };
}

function payload(
  items: readonly unknown[],
  page: Readonly<Record<string, unknown>> = { hasNext: false },
  scope: Readonly<Record<string, unknown>> = {}
): unknown {
  return {
    data: {
      workspaceId,
      projectId,
      items,
      page,
      ...scope
    },
    meta: { requestId: "internal-rank-history-001" }
  };
}

function foundItem() {
  return {
    snapshotId: firstSnapshotId,
    keywordId,
    trackingContextId: contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin.positions.v1",
    observedAt: "2026-07-29T12:00:00.000Z",
    storedAt: "2026-07-29T12:00:01.000Z",
    jobId,
    dataQualityFlags: [],
    found: true,
    position: 4,
    absolutePosition: 4,
    pixelPosition: 120,
    rankingUrl: "https://example.com/rank",
    normalizedRankingUrl: "https://example.com/rank",
    title: "Ranked page",
    snippet: "Result snippet",
    siteResults: [
      {
        position: 4,
        rankingUrl: "https://example.com/other",
        title: "Other page",
        snippet: "Other snippet"
      },
      { position: 9, rankingUrl: "https://example.com/rank" }
    ],
    resultType: "ORGANIC",
    serpFeatures: [],
    workspaceId,
    projectId,
    manifestId: "private-manifest",
    credentialId: "private-credential",
    rawProviderResponse: "private-provider-payload"
  };
}

function notFoundItem() {
  return {
    snapshotId: secondSnapshotId,
    keywordId,
    trackingContextId: contextId,
    configurationVersion: 2,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin.positions.v1",
    observedAt: "2026-07-29T11:00:00.000Z",
    storedAt: "2026-07-29T11:00:01.000Z",
    jobId,
    dataQualityFlags: [],
    found: false,
    position: null
  };
}
