import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticVersionService } from "./semantic-version.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const versionId = "01900000-0000-7000-8000-000000000010";
const keywordId = "01900000-0000-7000-8000-000000000020";
const clusterId = "01900000-0000-7000-8000-000000000021";
const undoVersionId = "01900000-0000-7000-8000-000000000011";
const idempotencyKey = "semantic-undo-test-0001";
const entitlement = {
  planCode: "TEAM",
  planVersion: 1,
  storedKeywords: 2_000_000,
  keywordsPerProject: 2_000_000,
  trackedContextPairs: 50_000
} as const;

test("preview refuses to overwrite a newer keyword version", async () => {
  const service = new SemanticVersionService({
    semanticVersion: {
      findFirst: async () => version()
    },
    semanticEntityChange: {
      findMany: async () => [createChange()]
    },
    keyword: {
      findMany: async () => [
        { id: keywordId, version: 2, status: "ACTIVE" }
      ]
    }
  } as unknown as PrismaService);

  const result = await service.previewUndo(
    workspaceId,
    projectId,
    versionId
  );

  assert.equal(result.applicable, 0);
  assert.equal(result.conflicted, 1);
  assert.equal(result.changes[0]?.conflictCode, "NEWER_CHANGE");
});

test("preview accepts an unchanged cluster mapping with available dependencies", async () => {
  const service = new SemanticVersionService({
    semanticVersion: {
      findFirst: async () => ({ ...version(), reason: "CLUSTER_UPDATE" })
    },
    semanticEntityChange: {
      findMany: async () => [clusterChange()]
    },
    cluster: {
      findMany: async () => [
        { id: clusterId, version: 2, status: "ACTIVE" }
      ],
      findFirst: async () => null
    }
  } as unknown as PrismaService);

  const result = await service.previewUndo(
    workspaceId,
    projectId,
    versionId
  );

  assert.equal(result.applicable, 1);
  assert.equal(result.changes[0]?.entityType, "CLUSTER");
  assert.equal(result.changes[0]?.state, "APPLICABLE");
});

test("merge undo preview restores a deleted source cluster before its keywords", async () => {
  const targetClusterId = "01900000-0000-7000-8000-000000000022";
  const beforeKeyword = { ...keywordState(), clusterId };
  const afterKeyword = { ...beforeKeyword, clusterId: targetClusterId };
  const beforeCluster = clusterState(null);
  const changes = [
    {
      entityType: "CLUSTER",
      entityId: clusterId,
      operation: "DELETE",
      beforeState: beforeCluster,
      afterState: { ...beforeCluster, status: "DELETED" },
      beforeVersion: 1,
      afterVersion: 2,
      createdAt: new Date("2026-07-30T12:00:00.000Z"),
      id: "01900000-0000-7000-8000-000000000032"
    },
    {
      entityType: "KEYWORD",
      entityId: keywordId,
      operation: "UPDATE",
      beforeState: beforeKeyword,
      afterState: afterKeyword,
      beforeVersion: 1,
      afterVersion: 2,
      createdAt: new Date("2026-07-30T12:00:01.000Z"),
      id: "01900000-0000-7000-8000-000000000033"
    }
  ];
  const service = new SemanticVersionService({
    semanticVersion: {
      findFirst: async () => ({ ...version(), reason: "CLUSTER_MERGE", affectedCount: 2 })
    },
    semanticEntityChange: { findMany: async () => changes },
    cluster: {
      findMany: async () => [
        { id: clusterId, version: 2, status: "DELETED" }
      ],
      findFirst: async () => null
    },
    keyword: {
      findMany: async () => [
        { id: keywordId, version: 2, status: "ACTIVE" }
      ],
      findFirst: async () => null
    }
  } as unknown as PrismaService);

  const result = await service.previewUndo(workspaceId, projectId, versionId);

  assert.equal(result.applicable, 2);
  assert.deepEqual(result.changes.map(({ entityType, state }) => [entityType, state]), [
    ["CLUSTER", "APPLICABLE"],
    ["KEYWORD", "APPLICABLE"]
  ]);
});

test("split undo preview detaches restorable keywords before deleting the new cluster", async () => {
  const createdClusterId = "01900000-0000-7000-8000-000000000023";
  const beforeKeyword = { ...keywordState(), clusterId };
  const afterKeyword = { ...beforeKeyword, clusterId: createdClusterId };
  const sourceState = clusterState(null);
  const createdState = { ...clusterState(null), name: "Технический аудит" };
  const changes = [
    {
      entityType: "CLUSTER",
      entityId: clusterId,
      operation: "UPDATE",
      beforeState: sourceState,
      afterState: sourceState,
      beforeVersion: 2,
      afterVersion: 3,
      createdAt: new Date("2026-07-30T12:00:00.000Z"),
      id: "01900000-0000-7000-8000-000000000034"
    },
    {
      entityType: "CLUSTER",
      entityId: createdClusterId,
      operation: "CREATE",
      beforeState: null,
      afterState: createdState,
      beforeVersion: null,
      afterVersion: 1,
      createdAt: new Date("2026-07-30T12:00:01.000Z"),
      id: "01900000-0000-7000-8000-000000000035"
    },
    {
      entityType: "KEYWORD",
      entityId: keywordId,
      operation: "UPDATE",
      beforeState: beforeKeyword,
      afterState: afterKeyword,
      beforeVersion: 5,
      afterVersion: 6,
      createdAt: new Date("2026-07-30T12:00:02.000Z"),
      id: "01900000-0000-7000-8000-000000000036"
    }
  ];
  let countWhere: unknown;
  const service = new SemanticVersionService({
    semanticVersion: {
      findFirst: async () => ({
        ...version(),
        reason: "CLUSTER_SPLIT",
        affectedCount: 3
      })
    },
    semanticEntityChange: { findMany: async () => changes },
    cluster: {
      findMany: async () => [
        { id: clusterId, version: 3, status: "ACTIVE" },
        { id: createdClusterId, version: 1, status: "ACTIVE" }
      ],
      findFirst: async () => null
    },
    keyword: {
      findMany: async () => [
        { id: keywordId, version: 6, status: "ACTIVE" }
      ],
      findFirst: async () => null,
      count: async ({ where }: { where: unknown }) => {
        countWhere = where;
        return 0;
      }
    }
  } as unknown as PrismaService);

  const result = await service.previewUndo(workspaceId, projectId, versionId);

  assert.equal(result.applicable, 3);
  assert.deepEqual(countWhere, {
    workspaceId,
    projectId,
    clusterId: createdClusterId,
    status: "ACTIVE",
    id: { notIn: [keywordId] }
  });
});

test("undo creates a new version and soft-deletes only the exact current row", async () => {
  const keywordUpdates: unknown[] = [];
  const recordedChanges: unknown[] = [];
  let receipt: Record<string, unknown> | undefined;
  const source = version();
  const undo = {
    ...source,
    id: undoVersionId,
    number: 2,
    reason: "UNDO",
    actorId,
    parentVersionId: source.id,
    summary: "Откат версии №1",
    affectedCount: 0,
    reversible: false,
    finalizedAt: null
  };
  const transaction = {
    $executeRaw: async () => 1,
    semanticVersion: {
      findFirst: async ({ where }: { where: { id?: string } }) =>
        where.id === undoVersionId
          ? {
              ...undo,
              affectedCount: 1,
              reversible: true,
              finalizedAt: new Date("2026-07-30T12:05:00.000Z")
            }
          : source,
      create: async () => undo,
      update: async () => ({
        ...undo,
        affectedCount: 1,
        reversible: true,
        finalizedAt: new Date("2026-07-30T12:05:00.000Z")
      })
    },
    semanticUndoReceipt: {
      findUnique: async () => receipt,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        receipt = data;
        return data;
      }
    },
    semanticEntityChange: {
      findMany: async () => [createChange()],
      create: async ({ data }: { data: unknown }) => {
        recordedChanges.push(data);
        return data;
      }
    },
    keyword: {
      findMany: async () => [
        { id: keywordId, version: 1, status: "ACTIVE" }
      ],
      findFirstOrThrow: async () => ({
        id: keywordId,
        workspaceId,
        projectId,
        version: 1,
        status: "ACTIVE"
      }),
      update: async ({ data }: { data: unknown }) => {
        keywordUpdates.push(data);
        return {};
      }
    }
  };
  const service = new SemanticVersionService({
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await service.undo(
    workspaceId,
    projectId,
    actorId,
    versionId,
    idempotencyKey,
    entitlement
  );

  assert.equal(result.applied, 1);
  assert.equal(result.createdVersion?.reason, "UNDO");
  assert.equal(keywordUpdates.length, 1);
  assert.deepEqual(keywordUpdates[0], {
    status: "DELETED",
    deletedAt: keywordUpdates[0] &&
      typeof keywordUpdates[0] === "object" &&
      "deletedAt" in keywordUpdates[0]
        ? keywordUpdates[0].deletedAt
        : undefined,
    updatedBy: actorId,
    version: { increment: 1 }
  });
  assert.equal(recordedChanges.length, 1);

  const replay = await service.undo(
    workspaceId,
    projectId,
    actorId,
    versionId,
    idempotencyKey,
    entitlement
  );
  assert.deepEqual(replay, result);
  assert.equal(keywordUpdates.length, 1);
  assert.equal(recordedChanges.length, 1);
});

test("undo restores a cluster page mapping and records the inverse change", async () => {
  const clusterUpdates: unknown[] = [];
  const recordedChanges: Array<Record<string, unknown>> = [];
  const source = { ...version(), reason: "CLUSTER_UPDATE" };
  const undo = {
    ...source,
    id: undoVersionId,
    number: 2,
    reason: "UNDO",
    parentVersionId: source.id,
    summary: "Откат версии №1",
    affectedCount: 0,
    reversible: false,
    finalizedAt: null
  };
  const transaction = {
    $executeRaw: async () => 1,
    semanticVersion: {
      findFirst: async () => source,
      create: async () => undo,
      update: async () => ({
        ...undo,
        affectedCount: 1,
        reversible: true,
        finalizedAt: new Date("2026-07-30T12:05:00.000Z")
      })
    },
    semanticUndoReceipt: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => data
    },
    semanticEntityChange: {
      findMany: async () => [clusterChange()],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        recordedChanges.push(data);
        return data;
      }
    },
    cluster: {
      findMany: async () => [
        { id: clusterId, version: 2, status: "ACTIVE" }
      ],
      findFirst: async () => null,
      findFirstOrThrow: async () => ({
        id: clusterId,
        workspaceId,
        projectId,
        version: 2,
        status: "ACTIVE"
      }),
      update: async ({ data }: { data: unknown }) => {
        clusterUpdates.push(data);
        return {};
      }
    }
  };
  const service = new SemanticVersionService({
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await service.undo(
    workspaceId,
    projectId,
    actorId,
    versionId,
    "semantic-undo-cluster-0001",
    entitlement
  );

  assert.equal(result.applied, 1);
  assert.deepEqual(clusterUpdates, [
    {
      name: "SEO аудит",
      method: "MANUAL",
      status: "ACTIVE",
      primaryPageId: null,
      pageMappingSource: null,
      pageMappingConfidence: null,
      pageMappingRationale: null,
      isLocked: false,
      excludeFromReclustering: false,
      version: { increment: 1 }
    }
  ]);
  assert.equal(recordedChanges.length, 1);
  assert.equal(recordedChanges[0]?.entityType, "CLUSTER");
  assert.deepEqual(recordedChanges[0]?.beforeState, clusterState(
    "01900000-0000-7000-8000-000000000040"
  ));
  assert.deepEqual(recordedChanges[0]?.afterState, clusterState(null));
  assert.equal(recordedChanges[0]?.beforeVersion, 2);
  assert.equal(recordedChanges[0]?.afterVersion, 3);
});

function version() {
  return {
    id: versionId,
    workspaceId,
    projectId,
    number: 1,
    reason: "KEYWORD_CREATE",
    actorId,
    sourceJobId: null,
    parentVersionId: null,
    summary: "Добавлен поисковый запрос",
    affectedCount: 1,
    reversible: true,
    manifest: { schemaVersion: 1 },
    finalizedAt: new Date("2026-07-30T12:00:00.000Z"),
    createdAt: new Date("2026-07-30T12:00:00.000Z")
  };
}

function createChange() {
  return {
    entityType: "KEYWORD",
    entityId: keywordId,
    operation: "CREATE",
    beforeState: null,
    afterState: keywordState(),
    beforeVersion: null,
    afterVersion: 1,
    createdAt: new Date("2026-07-30T12:00:00.000Z"),
    id: "01900000-0000-7000-8000-000000000030"
  };
}

function keywordState() {
  return {
    textOriginal: "seo аудит",
    textNormalized: "seo аудит",
    normalizedHash: "a".repeat(64),
    language: "ru",
    priority: 0,
    isFavorite: false,
    intent: null,
    status: "ACTIVE",
    clusterId: null,
    targetPageId: null,
    groupId: null,
    tagIds: []
  };
}

function clusterChange() {
  return {
    entityType: "CLUSTER",
    entityId: clusterId,
    operation: "UPDATE",
    beforeState: clusterState(null),
    afterState: clusterState("01900000-0000-7000-8000-000000000040"),
    beforeVersion: 1,
    afterVersion: 2,
    createdAt: new Date("2026-07-30T12:00:00.000Z"),
    id: "01900000-0000-7000-8000-000000000031"
  };
}

function clusterState(primaryPageId: string | null) {
  return {
    name: "SEO аудит",
    method: "MANUAL",
    status: "ACTIVE",
    primaryPageId,
    pageMappingSource: primaryPageId ? "MANUAL" : null,
    pageMappingConfidence: null,
    pageMappingRationale: null,
    isLocked: false,
    excludeFromReclustering: false
  };
}
