import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { KeywordRankComparisonService } from "./keyword-rank-comparison.service.js";

const scope = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
};

test("rank-dimension Prisma filters never receive trusted actor metadata", async () => {
  const findFilters: unknown[] = [];
  const deleteFilters: unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    rankDimensionMerge: {
      deleteMany: async (input: Readonly<{ where: unknown }>) => {
        deleteFilters.push(input.where);
        return { count: 1 };
      }
    }
  };
  const prisma = {
    $queryRaw: async () => [],
    $transaction: async (run: (value: typeof transaction) => Promise<unknown>) => run(transaction),
    rankDimensionMerge: {
      findMany: async (input: Readonly<{ where: unknown }>) => {
        findFilters.push(input.where);
        return [];
      }
    }
  } as unknown as PrismaService;
  const service = new KeywordRankComparisonService(prisma);

  await service.mergeSettings(scope);
  await service.removeMerge(scope, "01900000-0000-7000-8000-000000000004", 2);

  assert.deepEqual(findFilters, [{
    workspaceId: scope.workspaceId,
    projectId: scope.projectId
  }]);
  assert.deepEqual(deleteFilters, [{
    id: "01900000-0000-7000-8000-000000000004",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    version: 2
  }]);
});
