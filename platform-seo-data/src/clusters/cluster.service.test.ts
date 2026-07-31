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
      pageMappingRationale: null
    },
    afterState: {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: pageId,
      pageMappingSource: "MANUAL",
      pageMappingConfidence: null,
      pageMappingRationale: "Совпадает интент"
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
      pageMappingRationale: null
    },
    afterState: {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: pageId,
      pageMappingSource: "MANUAL",
      pageMappingConfidence: null,
      pageMappingRationale: "Совпадает интент"
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
