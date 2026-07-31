import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { ClusterService } from "./cluster.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const clusterId = "01900000-0000-7000-8000-000000000004";
const pageId = "01900000-0000-7000-8000-000000000005";

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
  } as unknown as PrismaService);

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
  } as unknown as PrismaService);

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
  } as unknown as PrismaService);

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
