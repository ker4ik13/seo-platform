import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticCustomColumnService } from "./semantic-custom-column.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const columnId = "01900000-0000-7000-8000-000000000005";

test("creates a typed integer value only for scoped active owners", async () => {
  let createdData: unknown;
  const transaction = {
    $queryRaw: async () => [],
    semanticCustomColumn: {
      findFirst: async () => column("INTEGER")
    },
    keyword: {
      findFirst: async () => ({ id: keywordId })
    },
    semanticKeywordCustomValue: {
      findUnique: async () => null,
      create: async ({ data }: { data: unknown }) => {
        createdData = data;
      },
      findUniqueOrThrow: async () => ({
        workspaceId,
        projectId,
        keywordId,
        columnId,
        textValue: null,
        integerValue: BigInt(42),
        decimalValue: null,
        booleanValue: null,
        dateValue: null,
        datetimeValue: null,
        stringArrayValue: [],
        userId: null,
        version: 1,
        updatedBy: actorId,
        createdAt: new Date("2026-07-30T10:00:00Z"),
        updatedAt: new Date("2026-07-30T10:00:00Z"),
        column: { type: "INTEGER" as const }
      })
    }
  };
  const service = new SemanticCustomColumnService({
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await service.setKeywordValue(keywordId, columnId, {
    workspaceId,
    projectId,
    actorId,
    expectedVersion: null,
    value: 42
  });

  assert.deepEqual(createdData, {
    workspaceId,
    projectId,
    keywordId,
    columnId,
    integerValue: BigInt(42),
    updatedBy: actorId
  });
  assert.equal(result.value, 42);
  assert.equal(result.version, 1);
});

function column(type: "INTEGER") {
  return {
    id: columnId,
    workspaceId,
    projectId,
    name: "Score",
    normalizedName: "score",
    description: null,
    type,
    config: { required: false },
    status: "ACTIVE" as const,
    version: 1,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date("2026-07-30T10:00:00Z"),
    updatedAt: new Date("2026-07-30T10:00:00Z"),
    deletedAt: null
  };
}
