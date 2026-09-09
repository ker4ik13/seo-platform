import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  mergedRankDimensionCatalog,
  rankDimensionSources
} from "./rank-dimension-merge.js";

const scope = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002"
};
const sourceKey = "GOOGLE|RU|global|ru|DESKTOP";
const targetKey = "GOOGLE|RU|213|ru|DESKTOP";

function database(): PrismaService {
  return {
    $queryRaw: async () => [
      {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: "global",
        regionLabel: "Импорт Key Collector",
        language: "ru",
        device: "DESKTOP"
      },
      {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP"
      }
    ],
    rankDimensionMerge: {
      findMany: async (input: Readonly<{ where?: { targetDimensionKey?: string } }>) =>
        input.where?.targetDimensionKey
          ? [{ sourceDimensionKey: sourceKey, sourceRegionLabel: "Импорт Key Collector" }]
          : [{
              sourceDimensionKey: sourceKey,
              targetDimensionKey: targetKey,
              targetRegionLabel: "Москва"
            }]
    }
  } as unknown as PrismaService;
}

test("merged catalog hides the source and preserves the target label", async () => {
  const catalog = await mergedRankDimensionCatalog(database(), scope);
  assert.deepEqual(catalog.dimensions.map(({ key, regionLabel }) => ({ key, regionLabel })), [
    { key: targetKey, regionLabel: "Москва" }
  ]);
});

test("target reads include its immutable source history", async () => {
  const target = {
    key: targetKey,
    searchEngine: "GOOGLE" as const,
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP" as const
  };
  const sources = await rankDimensionSources(database(), scope, target);
  assert.deepEqual(sources.map(({ key }) => key), [targetKey, sourceKey]);
});
