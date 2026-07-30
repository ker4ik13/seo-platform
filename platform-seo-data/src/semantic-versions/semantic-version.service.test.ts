import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticVersionService } from "./semantic-version.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const versionId = "01900000-0000-7000-8000-000000000010";
const keywordId = "01900000-0000-7000-8000-000000000020";
const undoVersionId = "01900000-0000-7000-8000-000000000011";
const idempotencyKey = "semantic-undo-test-0001";

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
    idempotencyKey
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
    idempotencyKey
  );
  assert.deepEqual(replay, result);
  assert.equal(keywordUpdates.length, 1);
  assert.equal(recordedChanges.length, 1);
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
