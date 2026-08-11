import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import {
  scopedTrackingContextKeywordState,
  trackingContextCollection,
  trackingContextKeywordPage
} from "../rankings/tracking-context-response.js";
import {
  semanticKeywordGroups,
  semanticKeywordBulkCreateResult,
  semanticKeywordBulkResult,
  semanticKeywordCleaningPreview,
  semanticKeywordCleaningResult,
  semanticKeywordInsights,
  semanticKeywordPage,
  semanticClusterPageBulkPreview,
  semanticClusterPageBulkResult,
  semanticClusterMergePreview,
  semanticClusterMergeResult,
  semanticClusterSplitPreview,
  semanticClusterSplitResult,
  semanticClusters,
  semanticCustomColumns,
  semanticKeywordCustomValue,
  semanticNegativeKeywordApplyResult,
  semanticNegativeKeywordPreset,
  semanticNegativeKeywordPreview,
  semanticSavedViews,
  SeoDataClient
} from "./seo-data.client.js";

const validItem = {
  id: "01900000-0000-7000-8000-000000000010",
  textOriginal: "SEO аудит",
  textNormalized: "seo аудит",
  language: "ru",
  priority: 0,
  isFavorite: true,
  isTracked: false,
  intent: "COMMERCIAL",
  groupId: "01900000-0000-7000-8000-000000000011",
  groupPath: "Услуги / SEO",
  targetPageId: "01900000-0000-7000-8000-000000000012",
  targetUrl: "https://example.com/seo",
  tags: ["Приоритет"],
  tagsTruncated: false,
  frequency: {
    value: "12890",
    regionCode: "213",
    device: "ALL",
    provider: "XMLSTOCK",
    observedAt: "2026-08-01T10:00:00.000Z"
  },
  frequencies: [
    {
      type: "BASE",
      value: "12890",
      regionCode: "213",
      device: "ALL",
      provider: "XMLSTOCK",
      observedAt: "2026-08-01T10:00:00.000Z"
    },
    {
      type: "EXACT",
      value: "5123",
      regionCode: "213",
      device: "ALL",
      provider: "ARSENKIN",
      observedAt: "2026-08-01T10:00:00.000Z"
    },
    {
      type: "FIXED",
      value: "5122",
      regionCode: "213",
      device: "ALL",
      provider: "ARSENKIN",
      observedAt: "2026-08-01T10:00:00.000Z"
    }
  ],
  positions: [
    {
      searchEngine: "YANDEX",
      found: true,
      position: 5,
      previousPosition: 8,
      rankingUrl: "https://example.com/seo",
      observedAt: "2026-08-01T10:00:00.000Z"
    }
  ],
  sourceMode: "IMPORT",
  createdAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:00:00.000Z",
  version: 1
};
const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("loads complete semantic counters for platform project administration", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { readonly url: URL; readonly headers: Headers; readonly body: unknown } | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    captured = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as unknown
    };
    return jsonResponse({
      data: {
        projects: [{ projectId, keywordCount: 1640, folderCount: 84 }]
      }
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await client().adminProjectCounts(
        [projectId],
        actorId,
        "request-admin-project-statistics-001"
      ),
      [{ projectId, keywordCount: 1640, folderCount: 84 }]
    );
    assert.equal(
      captured?.url.pathname,
      "/internal/v1/platform-admin/project-statistics"
    );
    assert.equal(captured?.headers.get("x-actor-id"), actorId);
    assert.deepEqual(captured?.body, { projectIds: [projectId] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
const contextId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const assignmentId = "01900000-0000-7000-8000-000000000006";
const contextResponse = {
  id: contextId,
  workspaceId,
  projectId,
  name: "Google · Москва · desktop",
  status: "ACTIVE",
  configuration: {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "INCLUDE_WWW" },
    safeSearch: false,
    configurationVersion: 1,
    createdBy: actorId,
    createdAt: "2026-07-29T10:00:00.000Z"
  },
  assignedKeywordCount: 1,
  version: 1,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z"
};

test("accepts a strictly shaped semantic keyword page", () => {
  const result = semanticKeywordPage({
    data: [validItem],
    page: { hasNext: false, totalApprox: 1 },
    meta: { requestId: "internal-request" }
  });

  assert.equal(result.data[0]?.textOriginal, "SEO аудит");
  assert.equal(result.data[0]?.frequency?.value, "12890");
  assert.deepEqual(
    result.data[0]?.frequencies?.map(({ type, value }) => ({ type, value })),
    [
      { type: "BASE", value: "12890" },
      { type: "EXACT", value: "5123" },
      { type: "FIXED", value: "5122" }
    ]
  );
  assert.equal(result.data[0]?.positions?.[0]?.position, 5);
  assert.equal(result.data[0]?.positions?.[0]?.rankingUrl, "https://example.com/seo");
  assert.equal(result.data[0]?.hasNote, false);
  assert.deepEqual(result.page, { hasNext: false, totalApprox: 1 });
});

test("validates safe interactive rank history metadata", () => {
  const insights = semanticKeywordInsights({
    keywordId,
    frequencies: [],
    positions: [],
    positionHistory: [{
      snapshotId: "01900000-0000-7000-8000-000000000007",
      trackingContextId: contextId,
      contextName: "Яндекс · Москва",
      searchEngine: "YANDEX",
      searchSource: "LIVE",
      device: "DESKTOP",
      regionCode: "213",
      regionLabel: "Москва",
      countryCode: "RU",
      language: "ru",
      depth: 50,
      provider: "XMLSTOCK",
      found: false,
      observedAt: "2026-08-06T11:45:00.000Z"
    }]
  }, keywordId);

  assert.equal(insights.positionHistory[0]?.searchSource, "LIVE");
  assert.equal(insights.positionHistory[0]?.regionLabel, "Москва");
  assert.equal(insights.positionHistory[0]?.depth, 50);
  const withCompetitors = semanticKeywordInsights({
    ...insights,
    competitorSnapshots: [{
      snapshotId: "01900000-0000-7000-8000-000000000007",
      trackingContextId: contextId,
      contextName: "Яндекс · Москва",
      searchEngine: "YANDEX",
      searchSource: "LIVE",
      provider: "XMLSTOCK",
      observedAt: "2026-08-06T11:45:00.000Z",
      results: [{
        position: 1,
        url: "https://competitor.example/result",
        title: "Конкурент"
      }]
    }]
  }, keywordId);
  assert.equal(withCompetitors.competitorSnapshots?.[0]?.results[0]?.position, 1);
  const { searchSource: _searchSource, ...importedPoint } =
    insights.positionHistory[0]!;
  const imported = semanticKeywordInsights({
    ...insights,
    positionHistory: [{
      ...importedPoint,
      provider: "KEY_COLLECTOR"
    }]
  }, keywordId);
  assert.equal(imported.positionHistory[0]?.provider, "KEY_COLLECTOR");
  assert.equal(imported.positionHistory[0]?.searchSource, undefined);
  assert.throws(
    () => semanticKeywordInsights({
      ...insights,
      positionHistory: [{
        ...insights.positionHistory[0]!,
        provider: "KEYS_SO"
      }]
    }, keywordId),
    DomainError
  );
});

test("validates negative keyword presets, preview and bounded apply results", () => {
  const preset = semanticNegativeKeywordPreset({
    id: "01900000-0000-7000-8000-000000000030",
    name: "Города",
    rules: { words: ["москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
    version: 1,
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z"
  });
  assert.equal(preset.rules.words[0], "москва");
  assert.equal(preset.rules.ignoreWordOrder, false);
  assert.equal(preset.rules.ignorePunctuation, false);
  const preview = semanticNegativeKeywordPreview({
    scannedCount: 10,
    matchedCount: 1,
    batchCount: 1,
    hasMore: false,
    previewHash: "a".repeat(64),
    matchesTruncated: false,
    matches: [{
      keywordId,
      text: "туры москва",
      version: 2,
      matchedWords: ["москва"]
    }]
  });
  assert.equal(preview.matches[0]?.keywordId, keywordId);
  assert.deepEqual(semanticNegativeKeywordApplyResult({ deletedCount: 1, hasMore: false }), {
    deletedCount: 1,
    hasMore: false
  });
  assert.throws(
    () => semanticNegativeKeywordApplyResult({ deletedCount: 501, hasMore: false }),
    DomainError
  );
});

test("rejects malformed SEO data responses", () => {
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [{ ...validItem, sourceMode: "UNKNOWN" }],
        page: { hasNext: false }
      }),
    DomainError
  );
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [validItem],
        page: { hasNext: "false" }
      }),
    DomainError
  );
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [
          {
            ...validItem,
            frequencies: [validItem.frequencies[0], validItem.frequencies[0]]
          }
        ],
        page: { hasNext: false }
      }),
    DomainError
  );
});

test("validates a complete semantic group tree", () => {
  const parentId = "01900000-0000-7000-8000-000000000020";
  const childId = "01900000-0000-7000-8000-000000000021";
  const groups = semanticKeywordGroups([
    {
      id: parentId,
      name: "Услуги",
      path: "Услуги",
      color: "#6758ef",
      position: 0,
      keywordCount: 1,
      version: 1,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z"
    },
    {
      id: childId,
      parentId,
      name: "SEO",
      path: "Услуги / SEO",
      position: 0,
      keywordCount: 2,
      version: 1,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z"
    }
  ]);
  assert.equal(groups[1]?.parentId, parentId);
  assert.throws(
    () =>
      semanticKeywordGroups([
        { ...groups[1], parentId: "01900000-0000-7000-8000-000000000099" }
      ]),
    DomainError
  );
});

test("validates unique manual semantic clusters", () => {
  const cluster = {
    id: "01900000-0000-7000-8000-000000000022",
    name: "SEO аудит",
    method: "MANUAL",
    keywordCount: 4,
    isLocked: false,
    excludeFromReclustering: false,
    pageDiagnostics: {
      mappedKeywordCount: 3,
      unmappedKeywordCount: 1,
      competingPageCount: 1,
      hasCannibalization: true,
      hasMissingLanding: true
    },
    version: 2,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  assert.equal(semanticClusters([cluster])[0]?.keywordCount, 4);
  assert.throws(() => semanticClusters([{ ...cluster, method: "UNKNOWN" }]), DomainError);
  assert.throws(() => semanticClusters([cluster, cluster]), DomainError);
});

test("validates cluster page mapping preview and complete result partitions", () => {
  const first = "01900000-0000-7000-8000-000000000022";
  const second = "01900000-0000-7000-8000-000000000023";
  const pageId = "01900000-0000-7000-8000-000000000024";
  const input = {
    items: [
      { id: first, version: 2 },
      { id: second, version: 3 }
    ],
    primaryPageId: pageId,
    pageMappingSource: "MANUAL" as const
  };
  const preview = semanticClusterPageBulkPreview(
    {
      selected: 2,
      applicable: 1,
      skipped: 0,
      conflicted: 1,
      changes: [
        {
          clusterId: first,
          state: "APPLICABLE",
          expectedVersion: 2,
          currentVersion: 2,
          targetPrimaryPageId: pageId
        },
        {
          clusterId: second,
          state: "CONFLICTED",
          expectedVersion: 3,
          currentVersion: 4,
          targetPrimaryPageId: pageId
        }
      ]
    },
    input
  );
  assert.equal(preview.conflicted, 1);
  assert.throws(
    () =>
      semanticClusterPageBulkPreview(
        {
          ...preview,
          changes: [
            { ...preview.changes[0], targetPrimaryPageId: second },
            preview.changes[1]
          ]
        },
        input
      ),
    DomainError
  );

  const cluster = {
    id: first,
    name: "SEO аудит",
    method: "MANUAL",
    keywordCount: 4,
    isLocked: true,
    excludeFromReclustering: false,
    primaryPage: {
      id: pageId,
      url: "https://example.com/audit/",
      normalizedUrl: "https://example.com/audit/",
      pageType: "EXISTING",
      indexability: "INDEXABLE"
    },
    pageMappingSource: "MANUAL",
    pageDiagnostics: {
      mappedKeywordCount: 3,
      unmappedKeywordCount: 1,
      competingPageCount: 0,
      hasCannibalization: false,
      hasMissingLanding: false
    },
    version: 3,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  const result = semanticClusterPageBulkResult(
    {
      selected: 2,
      changed: 1,
      skipped: 0,
      conflicted: 1,
      updatedClusters: [cluster],
      skippedIds: [],
      conflictedIds: [second]
    },
    input
  );
  assert.equal(result.changed, 1);
  assert.throws(
    () =>
      semanticClusterPageBulkResult(
        { ...result, conflictedIds: [first] },
        input
      ),
    DomainError
  );
});

test("validates coherent cluster merge preview and result", () => {
  const first = "01900000-0000-7000-8000-000000000022";
  const second = "01900000-0000-7000-8000-000000000023";
  const input = {
    items: [
      { id: first, version: 2 },
      { id: second, version: 3 }
    ],
    targetClusterId: first
  };
  const preview = semanticClusterMergePreview({
    readiness: "READY",
    selectedClusterCount: 2,
    sourceClusterCount: 1,
    movedKeywordCount: 12,
    sourcePageConflictCount: 1,
    lockedClusterCount: 0,
    conflictedIds: [],
    unavailableIds: [],
    synchronousKeywordLimit: 450
  }, input);
  assert.equal(preview.movedKeywordCount, 12);
  assert.throws(
    () => semanticClusterMergePreview({ ...preview, readiness: "CONFLICTED" }, input),
    DomainError
  );

  const targetCluster = {
    id: first,
    name: "SEO аудит",
    method: "MANUAL",
    keywordCount: 20,
    isLocked: false,
    excludeFromReclustering: false,
    pageDiagnostics: {
      mappedKeywordCount: 0,
      unmappedKeywordCount: 20,
      competingPageCount: 0,
      hasCannibalization: false,
      hasMissingLanding: true
    },
    version: 2,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  const result = semanticClusterMergeResult({
    targetCluster,
    mergedClusterIds: [second],
    movedKeywordCount: 12
  }, input);
  assert.deepEqual(result.mergedClusterIds, [second]);
  assert.throws(
    () => semanticClusterMergeResult({ ...result, mergedClusterIds: [first] }, input),
    DomainError
  );
});

test("validates coherent cluster split preview and result", () => {
  const sourceId = "01900000-0000-7000-8000-000000000042";
  const createdId = "01900000-0000-7000-8000-000000000043";
  const keywordId = "01900000-0000-7000-8000-000000000044";
  const input = {
    sourceCluster: { id: sourceId, version: 2 },
    keywordItems: [{ id: keywordId, version: 5 }],
    newClusterName: "Купить ноутбук"
  };
  const preview = semanticClusterSplitPreview({
    readiness: "READY",
    sourceClusterState: "READY",
    selectedKeywordCount: 1,
    movableKeywordCount: 1,
    sourceKeywordCount: 3,
    sourceWouldBeEmpty: false,
    duplicateName: false,
    sourceLocked: false,
    conflictedKeywordIds: [],
    unavailableKeywordIds: [],
    synchronousKeywordLimit: 450
  }, input);
  assert.equal(preview.readiness, "READY");
  assert.throws(
    () => semanticClusterSplitPreview({ ...preview, duplicateName: true }, input),
    DomainError
  );
  const clusterBase = {
    name: "Исходный",
    method: "MANUAL",
    keywordCount: 2,
    isLocked: false,
    excludeFromReclustering: false,
    pageDiagnostics: {
      mappedKeywordCount: 0,
      unmappedKeywordCount: 2,
      competingPageCount: 0,
      hasCannibalization: false,
      hasMissingLanding: true
    },
    version: 3,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  const result = semanticClusterSplitResult({
    sourceCluster: { id: sourceId, ...clusterBase },
    createdCluster: {
      id: createdId,
      ...clusterBase,
      name: input.newClusterName,
      keywordCount: 1,
      version: 1,
      pageDiagnostics: {
        ...clusterBase.pageDiagnostics,
        unmappedKeywordCount: 1
      }
    },
    movedKeywordCount: 1
  }, input);
  assert.equal(result.createdCluster.id, createdId);
  assert.throws(
    () => semanticClusterSplitResult({ ...result, movedKeywordCount: 0 }, input),
    DomainError
  );
});

test("validates a complete semantic bulk result partition", () => {
  const first = validItem.id;
  const second = "01900000-0000-7000-8000-000000000030";
  const input = {
    items: [
      { id: first, version: 1 },
      { id: second, version: 2 }
    ],
    patch: { priority: 10 }
  };
  const result = semanticKeywordBulkResult(
    {
      selected: 2,
      changed: 1,
      skipped: 0,
      failed: 0,
      conflicted: 1,
      updatedItems: [validItem],
      conflictedIds: [second],
      skippedIds: [],
      failedIds: []
    },
    input
  );
  assert.equal(result.changed, 1);
  assert.throws(
    () =>
      semanticKeywordBulkResult(
        {
          ...result,
          changed: 2,
          updatedItems: [validItem]
        },
        input
      ),
    DomainError
  );
});

test("validates indexed semantic bulk create outcomes", () => {
  const input = {
    duplicatePolicy: "SKIP_EXISTING" as const,
    items: [
      {
        text: "SEO аудит",
        language: "ru",
        priority: 0,
        isFavorite: false,
        tagNames: []
      },
      {
        text: "SEO аудит",
        language: "ru",
        priority: 0,
        isFavorite: false,
        tagNames: []
      }
    ]
  };
  const value = {
    selected: 2,
    created: 1,
    restored: 0,
    linked: 0,
    skipped: 1,
    rejected: 0,
    failed: 0,
    rows: [
      {
        index: 0,
        outcome: "CREATED",
        keywordId: validItem.id,
        version: 1
      },
      {
        index: 1,
        outcome: "SKIPPED_EXISTING",
        keywordId: validItem.id,
        version: 1,
        trashed: true
      }
    ]
  };

  const parsed = semanticKeywordBulkCreateResult(value, input);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.rows[1]?.trashed, true);
  assert.throws(
    () =>
      semanticKeywordBulkCreateResult(
        {
          ...value,
          rows: [value.rows[0], { ...value.rows[1], index: 0 }]
        },
        input
      ),
    DomainError
  );
});

test("accepts a canonical keyword linked into another group", () => {
  const input = {
    duplicatePolicy: "ADD_TO_GROUP" as const,
    items: [
      {
        text: "SEO аудит",
        language: "ru",
        priority: 0,
        isFavorite: false,
        groupId: "01900000-0000-7000-8000-000000000010",
        tagNames: []
      }
    ]
  };
  const result = semanticKeywordBulkCreateResult(
    {
      selected: 1,
      created: 0,
      restored: 0,
      linked: 1,
      skipped: 0,
      rejected: 0,
      failed: 0,
      rows: [
        {
          index: 0,
          outcome: "LINKED_EXISTING",
          keywordId: validItem.id,
          version: 1
        }
      ]
    },
    input
  );

  assert.equal(result.linked, 1);
  assert.equal(result.rows[0]?.outcome, "LINKED_EXISTING");
});

test("validates keyword cleaning preview and result partitions", () => {
  const first = validItem.id;
  const second = "01900000-0000-7000-8000-000000000030";
  const input = {
    items: [
      { id: first, version: 1 },
      { id: second, version: 2 }
    ],
    rules: { collapseWhitespace: true }
  };
  const preview = semanticKeywordCleaningPreview(
    {
      selected: 2,
      applicable: 1,
      unchanged: 0,
      conflicted: 0,
      failed: 1,
      changes: [
        {
          keywordId: first,
          state: "APPLICABLE",
          expectedVersion: 1,
          currentVersion: 1,
          beforeText: "SEO   аудит",
          afterText: "SEO аудит"
        },
        {
          keywordId: second,
          state: "UNAVAILABLE",
          expectedVersion: 2
        }
      ]
    },
    input
  );
  assert.equal(preview.applicable, 1);
  assert.throws(
    () =>
      semanticKeywordCleaningPreview(
        { ...preview, applicable: 2 },
        input
      ),
    DomainError
  );

  const result = semanticKeywordCleaningResult(
    {
      selected: 2,
      changed: 1,
      unchanged: 0,
      conflicted: 0,
      failed: 1,
      updatedItems: [validItem],
      unchangedIds: [],
      conflictedIds: [],
      failedIds: [second]
    },
    input
  );
  assert.equal(result.changed, 1);
  assert.throws(
    () =>
      semanticKeywordCleaningResult(
        { ...result, failedIds: [first] },
        input
      ),
    DomainError
  );
});

test("validates versioned semantic saved views and rejects DSL drift", () => {
  const view = {
    id: "01900000-0000-7000-8000-000000000040",
    ownerId: actorId,
    scope: "PRIVATE",
    name: "Основное",
    config: {
      schemaVersion: 1,
      filters: { isTracked: true, priorityMin: 10 },
      sort: "PRIORITY_DESC",
      columns: ["query", "priority"],
      density: "COMPACT"
    },
    version: 2,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  assert.equal(semanticSavedViews([view])[0]?.config.sort, "PRIORITY_DESC");
  assert.throws(
    () =>
      semanticSavedViews([
        {
          ...view,
          config: { ...view.config, columns: ["query", "query"] }
        }
      ]),
    DomainError
  );
  assert.throws(
    () => semanticSavedViews([view, view]),
    DomainError
  );
});

test("validates typed custom column definitions and values", () => {
  const column = {
    id: "01900000-0000-7000-8000-000000000050",
    name: "Этап",
    type: "STATUS",
    config: {
      required: true,
      options: [
        { id: "new", label: "Новый" },
        { id: "done", label: "Готово", color: "#22aa66" }
      ]
    },
    version: 1,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z"
  };
  assert.equal(semanticCustomColumns([column])[0]?.type, "STATUS");
  assert.deepEqual(
    semanticKeywordCustomValue({
      columnId: column.id,
      value: "new",
      version: 2,
      updatedAt: "2026-07-30T11:00:00.000Z"
    }).value,
    "new"
  );
  assert.throws(
    () =>
      semanticCustomColumns([
        { ...column, config: { required: true } }
      ]),
    DomainError
  );
});

test("accepts a scoped bounded tracking-context aggregate", () => {
  const result = trackingContextCollection(
    {
      contexts: [contextResponse],
      contextsTruncated: false
    },
    workspaceId,
    projectId
  );

  assert.equal(result.contexts[0]?.id, contextId);
  assert.equal(
    result.contexts[0]?.configuration.configurationVersion,
    1
  );
  assert.equal(result.contextsTruncated, false);
});

test("rejects malformed, duplicate and cross-tenant tracking contexts", () => {
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            contextResponse,
            { ...contextResponse, name: "Duplicate" }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            {
              ...contextResponse,
              providerCredentialId:
                "01900000-0000-7000-8000-000000000098"
            }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            {
              ...contextResponse,
              workspaceId:
                "01900000-0000-7000-8000-000000000099"
            }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            {
              ...contextResponse,
              status: "ARCHIVED"
            }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
});

test("validates assigned keyword pages and point mutation states", () => {
  const page = trackingContextKeywordPage(
    {
      data: [
        {
          assignmentId,
          contextId,
          keywordId,
          keywordVersion: 7,
          textOriginal: "SEO аудит",
          language: "ru",
          assignedBy: actorId,
          assignedAt: "2026-07-29T10:05:00.000Z"
        }
      ],
      page: {
        hasNext: false,
        totalApprox: 1
      },
      meta: { requestId: "internal-request-001" }
    },
    contextId
  );
  const assigned = scopedTrackingContextKeywordState(
    {
      contextId,
      keywordId,
      assigned: true,
      assignmentId,
      changedAt: "2026-07-29T10:05:00.000Z"
    },
    contextId,
    keywordId,
    true
  );

  assert.equal(page.data[0]?.keywordId, keywordId);
  assert.equal(page.data[0]?.keywordVersion, 7);
  assert.equal(assigned.assignmentId, assignmentId);
  assert.throws(
    () =>
      scopedTrackingContextKeywordState(
        {
          contextId,
          keywordId,
          assigned: false,
          assignmentId
        },
        contextId,
        keywordId,
        false
      ),
    DomainError
  );
});

test("forwards an idempotent create through trusted tenant headers and body", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  let capturedRedirect: RequestInit["redirect"];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    capturedRedirect = init?.redirect;
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return jsonResponse({ data: contextResponse });
  }) as typeof fetch;

  try {
    const result = await client().createTrackingContext(
      internalContext(),
      {
        name: contextResponse.name,
        configuration: {
          searchEngine: "GOOGLE",
          countryCode: "RU",
          regionCode: "213",
          regionLabel: "Москва",
          language: "ru",
          device: "DESKTOP",
          depth: 30,
          domainMatchRule: { mode: "INCLUDE_WWW" },
          safeSearch: false
        }
      },
      "tracking-context-create-001"
    );

    assert.equal(result.id, contextId);
    assert.equal(capturedUrl?.pathname, `/internal/v1/projects/${projectId}/tracking-contexts`);
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), projectId);
    assert.deepEqual(capturedBody, {
      name: contextResponse.name,
      configuration: {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        depth: 30,
        domainMatchRule: { mode: "INCLUDE_WWW" },
        safeSearch: false
      },
      workspaceId,
      projectId,
      actorId,
      idempotencyKey: "tracking-context-create-001"
    });
    assert.equal(capturedRedirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards normalized tag suggestions through the trusted project route", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    return jsonResponse({ data: ["Бренд", "брендовый"] });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await client().listKeywordTagOptions(internalContext(), "бренд"),
      ["Бренд", "брендовый"]
    );
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/projects/${projectId}/keywords/tag-options`
    );
    assert.equal(capturedUrl?.searchParams.get("search"), "бренд");
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), projectId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scopes crawl issue requests to the selected page", async () => {
  const originalFetch = globalThis.fetch;
  const pageId = "01900000-0000-7000-8000-000000000020";
  let capturedUrl: URL | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    return jsonResponse({ data: { issues: [] } });
  }) as typeof fetch;

  try {
    const result = await client().listProjectCrawlIssues(
      internalContext(),
      pageId
    );

    assert.deepEqual(result, { issues: [] });
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/projects/${projectId}/crawl-issues`
    );
    assert.equal(capturedUrl?.searchParams.get("pageId"), pageId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves only the safe current version from an upstream conflict", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          details: {
            currentVersion: 4,
            internalRevision: "must-not-leak"
          }
        }
      }),
      {
        status: 412,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().updateTrackingContext(
        internalContext(),
        contextId,
        {
          name: contextResponse.name,
          configuration: {
            searchEngine: "GOOGLE",
            countryCode: "RU",
            regionCode: "213",
            regionLabel: "Москва",
            language: "ru",
            device: "DESKTOP",
            depth: 30,
            domainMatchRule: { mode: "INCLUDE_WWW" },
            safeSearch: false
          }
        },
        1
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VERSION_CONFLICT" &&
        error.statusCode === 412 &&
        error.details?.currentVersion === 4 &&
        !Object.hasOwn(error.details, "internalRevision")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards the semantic undo idempotency key inside the trusted command", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return jsonResponse({
      data: {
        sourceVersionId: contextId,
        applied: 0,
        conflicted: 0,
        unsupported: 0,
        changes: []
      }
    });
  }) as typeof fetch;

  try {
    const result = await client().undoSemanticVersion(
      internalContext(),
      contextId,
      "semantic-undo-client-0001",
      {
        planCode: "TEAM",
        planVersion: 1,
        storedKeywords: 2_000_000,
        keywordsPerProject: 2_000_000,
        foldersPerProject: 500,
        trackedContextPairs: 50_000
      }
    );

    assert.equal(result.sourceVersionId, contextId);
    assert.deepEqual(capturedBody, {
      workspaceId,
      projectId,
      actorId,
      idempotencyKey: "semantic-undo-client-0001",
      entitlement: {
        planCode: "TEAM",
        planVersion: 1,
        storedKeywords: 2_000_000,
        keywordsPerProject: 2_000_000,
        foldersPerProject: 500,
        trackedContextPairs: 50_000
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): SeoDataClient {
  return new SeoDataClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_SEO_DATA_TOKEN: "i".repeat(32),
      SEO_DATA_INTERNAL_URL: "http://seo-data.test:4001"
    })
  );
}

function internalContext() {
  return {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE" as const,
      projectId,
      projectStatus: "ACTIVE" as const,
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-tracking-context-001"
  };
}

function jsonResponse(value: unknown): Response {
  const response = value as Readonly<Record<string, unknown>>;
  return new Response(
    JSON.stringify({
      ...response,
      meta: { requestId: "internal-request-001" }
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
