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

test("comparison loads dimension merges once and skips unused AI reads", async () => {
  let mergeReads = 0;
  let rankReads = 0;
  const queries: string[] = [];
  const keywordId = "01900000-0000-7000-8000-000000000004";
  const dimensionKeys = [
    "YANDEX|RU|213|ru|DESKTOP",
    "YANDEX|RU|10758|ru|DESKTOP"
  ];
  const prisma = {
    keyword: {
      count: async () => 1
    },
    rankDimensionMerge: {
      findMany: async () => {
        mergeReads += 1;
        return [];
      }
    },
    $queryRaw: async (query: Readonly<{ sql?: string }>) => {
      rankReads += 1;
      queries.push(query.sql ?? "");
      return [];
    }
  } as unknown as PrismaService;
  const service = new KeywordRankComparisonService(prisma);

  assert.deepEqual(await service.compare(scope, {
    keywordIds: [keywordId],
    dimensionKeys,
    includeAi: false
  }), []);
  assert.equal(mergeReads, 1);
  assert.equal(rankReads, 2, "one SEO query per dimension is sufficient");

  rankReads = 0;
  await service.compare(scope, { keywordIds: [keywordId], dimensionKeys });
  assert.equal(rankReads, 4, "legacy callers still receive SEO and AI data");

  rankReads = 0;
  queries.length = 0;
  await service.compareTrusted(scope, {
    keywordIds: [keywordId],
    dimensionKeys,
    columnKeys: dimensionKeys.map((key) => `rank:${key}:checkedAt` as const),
    includeSiteResultCount: false
  });
  assert.equal(rankReads, 2, "an exact checked-at projection skips every AI read");
  assert.ok(queries.every((query) => !query.includes("rank_serp_results")));
  assert.ok(queries.every((query) => !query.includes("previous.position")));
});
