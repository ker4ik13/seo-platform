import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { ClusterService } from "./cluster.service.js";
import type { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const clusterId = "01900000-0000-7000-8000-000000000004";
const pageId = "01900000-0000-7000-8000-000000000005";
const secondClusterId = "01900000-0000-7000-8000-000000000006";
const thirdClusterId = "01900000-0000-7000-8000-000000000007";
const missingClusterId = "01900000-0000-7000-8000-000000000008";
const semanticVersions = {
  createWithClusterChange: async () => undefined
} as unknown as SemanticVersionService;

const row = {
  id: clusterId,
  workspaceId,
  projectId,
  name: "SEO аудит",
  method: "MANUAL",
  evidence: null,
  primaryPageId: null,
  pageMappingSource: null,
  pageMappingConfidence: null,
  pageMappingRationale: null,
  isLocked: false,
  excludeFromReclustering: false,
  status: "ACTIVE" as const,
  version: 2,
  createdAt: new Date("2026-07-30T10:00:00Z"),
  updatedAt: new Date("2026-07-30T11:00:00Z"),
  primaryPage: null
};

test("lists tenant-scoped active clusters with active keyword counts", async () => {
  const observed: unknown[] = [];
  const service = new ClusterService({
    cluster: {
      findMany: async ({ where }: { where: unknown }) => {
        observed.push(where);
        return [row];
      }
    },
    keyword: {
      groupBy: async ({ where }: { where: unknown }) => {
        observed.push(where);
        return [
          { clusterId, targetPageId: null, _count: { _all: 4 } },
          {
            clusterId,
            targetPageId: "01900000-0000-7000-8000-000000000005",
            _count: { _all: 3 }
          }
        ];
      }
    }
  } as unknown as PrismaService, semanticVersions);

  const result = await service.list(workspaceId, projectId);

  assert.deepEqual(observed[0], { workspaceId, projectId, status: "ACTIVE" });
  assert.deepEqual(observed[1], {
    workspaceId,
    projectId,
    status: "ACTIVE",
    clusterId: { not: null }
  });
  assert.equal(result[0]?.keywordCount, 7);
  assert.equal(result[0]?.method, "MANUAL");
  assert.deepEqual(result[0]?.pageDiagnostics, {
    mappedKeywordCount: 3,
    unmappedKeywordCount: 4,
    competingPageCount: 1,
    hasCannibalization: false,
    hasMissingLanding: true
  });
});

test("maps an active tenant page and reports competing keyword pages", async () => {
  let selectedPageWhere: unknown;
  let recordedChange: unknown;
  const mappedRow = {
    ...row,
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент",
    version: 3,
    primaryPage: {
      id: pageId,
      url: "https://example.com/audit/",
      normalizedUrl: "https://example.com/audit/",
      pageType: "EXISTING" as const,
      indexability: "INDEXABLE" as const,
      status: "ACTIVE" as const
    }
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: pageId }],
    cluster: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        Object.hasOwn(where, "name") ? null : row,
      update: async () => mappedRow
    },
    page: {
      findFirst: async ({ where }: { where: unknown }) => {
        selectedPageWhere = where;
        return { id: pageId };
      }
    },
    keyword: {
      groupBy: async () => [
        { clusterId, targetPageId: pageId, _count: { _all: 2 } },
        {
          clusterId,
          targetPageId: "01900000-0000-7000-8000-000000000006",
          _count: { _all: 1 }
        },
        { clusterId, targetPageId: null, _count: { _all: 1 } }
      ]
    }
  };
  const service = new ClusterService({
    $transaction: async (
      callback: (tx: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService, {
    createWithClusterChange: async (
      _transaction: unknown,
      _input: unknown,
      change: unknown
    ) => {
      recordedChange = change;
      return undefined;
    }
  } as unknown as SemanticVersionService);

  const result = await service.update(clusterId, {
    workspaceId,
    projectId,
    actorId,
    name: "SEO аудит",
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент",
    version: 2
  });

  assert.deepEqual(selectedPageWhere, {
    id: pageId,
    workspaceId,
    projectId,
    status: "ACTIVE"
  });
  assert.equal(result.primaryPage?.id, pageId);
  assert.equal(result.pageDiagnostics.hasCannibalization, true);
  assert.equal(result.pageDiagnostics.competingPageCount, 1);
  assert.equal(result.pageDiagnostics.unmappedKeywordCount, 1);
  assert.deepEqual(recordedChange, {
    entityId: clusterId,
    operation: "UPDATE",
    beforeState: {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: null,
      pageMappingSource: null,
      pageMappingConfidence: null,
        pageMappingRationale: null,
        isLocked: false,
        excludeFromReclustering: false
    },
    afterState: {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: pageId,
      pageMappingSource: "MANUAL",
      pageMappingConfidence: null,
        pageMappingRationale: "Совпадает интент",
        isLocked: false,
        excludeFromReclustering: false
    },
    beforeVersion: 2,
    afterVersion: 3
  });
});

test("refuses to delete a cluster that still owns active keywords", async () => {
  let updated = false;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    cluster: {
      findFirst: async () => row,
      update: async () => {
        updated = true;
        return row;
      }
    },
    keyword: { count: async () => 2 }
  };
  const service = new ClusterService({
    $transaction: async (callback: (tx: typeof transaction) => Promise<void>) =>
      callback(transaction)
  } as unknown as PrismaService, semanticVersions);

  await assert.rejects(
    () =>
      service.delete(clusterId, {
        workspaceId,
        projectId,
        actorId,
        version: 2
      }),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.CONFLICT
  );
  assert.equal(updated, false);
});

test("previews applicable, unchanged, stale and unavailable page mappings", async () => {
  const activePage = {
    id: pageId,
    url: "https://example.com/audit/",
    normalizedUrl: "https://example.com/audit/",
    pageType: "EXISTING" as const,
    indexability: "INDEXABLE" as const,
    status: "ACTIVE" as const
  };
  const alreadyMapped = {
    ...row,
    id: secondClusterId,
    name: "Продвижение",
    version: 3,
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент",
    primaryPage: activePage
  };
  const stale = {
    ...row,
    id: thirdClusterId,
    name: "SEO услуги",
    version: 4
  };
  const service = new ClusterService({
    page: { findFirst: async () => ({ id: pageId }) },
    cluster: { findMany: async () => [row, alreadyMapped, stale] }
  } as unknown as PrismaService, semanticVersions);

  const preview = await service.previewPageMapping({
    workspaceId,
    projectId,
    actorId,
    items: [
      { id: clusterId, version: 2 },
      { id: secondClusterId, version: 3 },
      { id: thirdClusterId, version: 3 },
      { id: missingClusterId, version: 1 }
    ],
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент"
  });

  assert.deepEqual(
    preview.changes.map(({ clusterId: id, state }) => [id, state]),
    [
      [clusterId, "APPLICABLE"],
      [secondClusterId, "UNCHANGED"],
      [thirdClusterId, "CONFLICTED"],
      [missingClusterId, "UNAVAILABLE"]
    ]
  );
  assert.deepEqual(
    {
      selected: preview.selected,
      applicable: preview.applicable,
      skipped: preview.skipped,
      conflicted: preview.conflicted
    },
    { selected: 4, applicable: 1, skipped: 1, conflicted: 2 }
  );
});

test("bulk page mapping only updates applicable rows and records one version", async () => {
  let updateCount = 0;
  let recordedChanges: readonly unknown[] = [];
  const activePage = {
    id: pageId,
    url: "https://example.com/audit/",
    normalizedUrl: "https://example.com/audit/",
    pageType: "EXISTING" as const,
    indexability: "INDEXABLE" as const,
    status: "ACTIVE" as const
  };
  const alreadyMapped = {
    ...row,
    id: secondClusterId,
    name: "Продвижение",
    version: 3,
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент",
    primaryPage: activePage
  };
  const stale = {
    ...row,
    id: thirdClusterId,
    name: "SEO услуги",
    version: 4
  };
  const updated = {
    ...row,
    version: 3,
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент",
    primaryPage: activePage
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: pageId }],
    page: { findFirst: async () => ({ id: pageId }) },
    cluster: {
      findMany: async () => [row, alreadyMapped, stale],
      update: async () => {
        updateCount += 1;
        return updated;
      }
    },
    keyword: { groupBy: async () => [] }
  };
  const service = new ClusterService({
    $transaction: async (
      callback: (tx: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService, {
    createWithClusterChanges: async (
      _transaction: unknown,
      _input: unknown,
      changes: readonly unknown[]
    ) => {
      recordedChanges = changes;
      return undefined;
    }
  } as unknown as SemanticVersionService);

  const result = await service.bulkUpdatePageMapping({
    workspaceId,
    projectId,
    actorId,
    items: [
      { id: clusterId, version: 2 },
      { id: secondClusterId, version: 3 },
      { id: thirdClusterId, version: 3 }
    ],
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент"
  });

  assert.equal(updateCount, 1);
  assert.equal(recordedChanges.length, 1);
  assert.deepEqual(recordedChanges[0], {
    entityId: clusterId,
    operation: "UPDATE",
    beforeState: {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: null,
      pageMappingSource: null,
      pageMappingConfidence: null,
      pageMappingRationale: null,
      isLocked: false,
      excludeFromReclustering: false
    },
    afterState: {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: pageId,
      pageMappingSource: "MANUAL",
      pageMappingConfidence: null,
      pageMappingRationale: "Совпадает интент",
      isLocked: false,
      excludeFromReclustering: false
    },
    beforeVersion: 2,
    afterVersion: 3
  });
  assert.deepEqual(
    {
      selected: result.selected,
      changed: result.changed,
      skipped: result.skipped,
      conflicted: result.conflicted,
      updatedIds: result.updatedClusters.map(({ id }) => id),
      skippedIds: result.skippedIds,
      conflictedIds: result.conflictedIds
    },
    {
      selected: 3,
      changed: 1,
      skipped: 1,
      conflicted: 1,
      updatedIds: [clusterId],
      skippedIds: [secondClusterId],
      conflictedIds: [thirdClusterId]
    }
  );
});

test("previews and atomically merges bounded clusters with reversible changes", async () => {
  const sourcePageId = "01900000-0000-7000-8000-000000000009";
  const keywordId = "01900000-0000-7000-8000-000000000010";
  const source = {
    ...row,
    id: secondClusterId,
    name: "Технический аудит",
    version: 3,
    primaryPageId: sourcePageId,
    isLocked: true
  };
  const input = {
    workspaceId,
    projectId,
    actorId,
    items: [
      { id: clusterId, version: 2 },
      { id: secondClusterId, version: 3 }
    ],
    targetClusterId: clusterId
  };
  const previewService = new ClusterService({
    cluster: { findMany: async () => [row, source] },
    keyword: { count: async () => 1 }
  } as unknown as PrismaService, semanticVersions);

  const preview = await previewService.previewMerge(input);
  assert.deepEqual(preview, {
    readiness: "READY",
    selectedClusterCount: 2,
    sourceClusterCount: 1,
    movedKeywordCount: 1,
    sourcePageConflictCount: 1,
    lockedClusterCount: 1,
    conflictedIds: [],
    unavailableIds: [],
    synchronousKeywordLimit: 450
  });

  let keywordUpdate: unknown;
  let clusterUpdate: unknown;
  let recordedKeywordChanges: readonly unknown[] = [];
  let recordedClusterChanges: readonly unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    cluster: {
      findMany: async () => [row, source],
      updateMany: async ({ data }: { data: unknown }) => {
        clusterUpdate = data;
        return { count: 1 };
      }
    },
    keyword: {
      findMany: async () => [{
        id: keywordId,
        workspaceId,
        projectId,
        textOriginal: "технический аудит",
        textNormalized: "технический аудит",
        normalizedHash: "a".repeat(64),
        language: "ru",
        priority: 0,
        isFavorite: false,
        intent: null,
        status: "ACTIVE" as const,
        clusterId: secondClusterId,
        targetPageId: null,
        sourceMode: "MANUAL" as const,
        sourceId: null,
        isTracked: false,
        customValues: {},
        createdBy: actorId,
        updatedBy: actorId,
        version: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        memberships: [],
        tags: []
      }],
      updateMany: async ({ data }: { data: unknown }) => {
        keywordUpdate = data;
        return { count: 1 };
      },
      groupBy: async () => [
        { clusterId, targetPageId: null, _count: { _all: 1 } }
      ]
    }
  };
  const service = new ClusterService({
    $transaction: async (
      callback: (tx: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService, {
    createWithChanges: async (
      _transaction: unknown,
      _metadata: unknown,
      keywordChanges: readonly unknown[],
      clusterChanges: readonly unknown[]
    ) => {
      recordedKeywordChanges = keywordChanges;
      recordedClusterChanges = clusterChanges;
      return undefined;
    }
  } as unknown as SemanticVersionService);

  const result = await service.merge(input);

  assert.deepEqual(keywordUpdate, {
    clusterId,
    updatedBy: actorId,
    version: { increment: 1 }
  });
  assert.deepEqual(clusterUpdate, {
    status: "DELETED",
    version: { increment: 1 }
  });
  assert.equal(recordedKeywordChanges.length, 1);
  assert.equal(recordedClusterChanges.length, 1);
  assert.deepEqual(
    (recordedKeywordChanges[0] as { afterState: { clusterId: string } }).afterState.clusterId,
    clusterId
  );
  assert.deepEqual(
    (recordedClusterChanges[0] as { afterState: { status: string } }).afterState.status,
    "DELETED"
  );
  assert.deepEqual(result.mergedClusterIds, [secondClusterId]);
  assert.equal(result.movedKeywordCount, 1);
  assert.equal(result.targetCluster.keywordCount, 1);
});

test("previews a cluster split and refuses to empty the source cluster", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000030";
  let sourceKeywordCount = 3;
  const service = new ClusterService({
    cluster: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        Object.hasOwn(where, "name") ? null : row
    },
    keyword: {
      findMany: async () => [{ id: keywordId, version: 5, clusterId }],
      count: async () => sourceKeywordCount
    }
  } as unknown as PrismaService, semanticVersions);
  const input = {
    workspaceId,
    projectId,
    actorId,
    sourceCluster: { id: clusterId, version: 2 },
    keywordItems: [{ id: keywordId, version: 5 }],
    newClusterName: "Технический аудит"
  };

  const ready = await service.previewSplit(input);
  assert.equal(ready.readiness, "READY");
  assert.equal(ready.movableKeywordCount, 1);
  sourceKeywordCount = 1;
  const empty = await service.previewSplit(input);
  assert.equal(empty.readiness, "CONFLICTED");
  assert.equal(empty.sourceWouldBeEmpty, true);
});

test("atomically splits a cluster and records a reversible mixed change set", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000031";
  const createdClusterId = "01900000-0000-7000-8000-000000000032";
  const keyword = {
    id: keywordId,
    workspaceId,
    projectId,
    textOriginal: "технический аудит",
    textNormalized: "технический аудит",
    normalizedHash: "b".repeat(64),
    language: "ru",
    priority: 0,
    isFavorite: false,
    intent: null,
    status: "ACTIVE" as const,
    clusterId,
    targetPageId: null,
    sourceMode: "MANUAL" as const,
    sourceId: null,
    isTracked: false,
    customValues: {},
    createdBy: actorId,
    updatedBy: actorId,
    version: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    memberships: [],
    tags: []
  };
  const created = {
    ...row,
    id: createdClusterId,
    name: "Технический аудит",
    evidence: {
      source: "MANUAL_SPLIT",
      sourceClusterId: clusterId,
      actorId
    },
    version: 1
  };
  const updatedSource = { ...row, version: 3 };
  let movedData: unknown;
  let versionMetadata: unknown;
  let recordedKeywordChanges: readonly unknown[] = [];
  let recordedClusterChanges: readonly unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    cluster: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        Object.hasOwn(where, "name") ? null : row,
      create: async () => created,
      update: async () => updatedSource
    },
    keyword: {
      findMany: async () => [keyword],
      count: async () => 3,
      updateMany: async ({ data }: { data: unknown }) => {
        movedData = data;
        return { count: 1 };
      },
      groupBy: async () => [
        { clusterId, targetPageId: null, _count: { _all: 2 } },
        { clusterId: createdClusterId, targetPageId: null, _count: { _all: 1 } }
      ]
    }
  };
  const service = new ClusterService({
    $transaction: async (
      callback: (tx: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService, {
    createWithChanges: async (
      _transaction: unknown,
      metadata: unknown,
      keywordChanges: readonly unknown[],
      clusterChanges: readonly unknown[]
    ) => {
      versionMetadata = metadata;
      recordedKeywordChanges = keywordChanges;
      recordedClusterChanges = clusterChanges;
      return undefined;
    }
  } as unknown as SemanticVersionService);

  const result = await service.split({
    workspaceId,
    projectId,
    actorId,
    sourceCluster: { id: clusterId, version: 2 },
    keywordItems: [{ id: keywordId, version: 5 }],
    newClusterName: "Технический аудит"
  });

  assert.deepEqual(movedData, {
    clusterId: createdClusterId,
    updatedBy: actorId,
    version: { increment: 1 }
  });
  assert.equal(
    (versionMetadata as { reason: string }).reason,
    "CLUSTER_SPLIT"
  );
  assert.equal(recordedKeywordChanges.length, 1);
  assert.equal(recordedClusterChanges.length, 2);
  assert.deepEqual(
    (recordedKeywordChanges[0] as { afterState: { clusterId: string } })
      .afterState.clusterId,
    createdClusterId
  );
  assert.equal(
    (recordedClusterChanges[1] as { operation: string }).operation,
    "CREATE"
  );
  assert.equal(result.sourceCluster.keywordCount, 2);
  assert.equal(result.createdCluster.keywordCount, 1);
  assert.equal(result.movedKeywordCount, 1);
});
