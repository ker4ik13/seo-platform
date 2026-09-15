import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  mergedRankDimensionCatalog,
  rankDimensionSources,
  resolvedRankDimensionMergeTargets,
  rawAiRankDimensionCatalog,
  rawRankDimensionCatalog
} from "./rank-dimension-merge.js";

const scope = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002"
};
const sourceKey = "GOOGLE|RU|global|ru|DESKTOP";
const targetKey = "GOOGLE|RU|213|ru|DESKTOP";

test("rank catalog probes each configuration without scanning full imported history", async () => {
  let queryText = "";
  await rawRankDimensionCatalog({
    $queryRaw: async (query: unknown) => {
      queryText = ((query as { strings?: readonly string[] }).strings ?? []).join(" ");
      return [];
    },
    rankDimensionMerge: { findMany: async () => [] }
  } as unknown as PrismaService, scope);

  assert.match(queryText, /FROM tracking_context_versions configuration/u);
  assert.match(queryText, /context\.status = 'ACTIVE'/u);
  assert.match(queryText, /JOIN LATERAL/u);
  assert.match(queryText, /snapshot\.tracking_context_id = configuration\.context_id/u);
  assert.match(queryText, /LIMIT 1/u);
});

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

test("resolves chained merges into one final slice and all of its sources", async () => {
  const intermediateKey = "GOOGLE|RU|kc4-import|ru|DESKTOP";
  const merges = [
    {
      sourceDimensionKey: sourceKey,
      sourceRegionLabel: "Импорт Key Collector",
      targetDimensionKey: intermediateKey,
      targetRegionLabel: "Импорт Key Collector"
    },
    {
      sourceDimensionKey: intermediateKey,
      sourceRegionLabel: "Импорт Key Collector",
      targetDimensionKey: targetKey,
      targetRegionLabel: "Москва"
    }
  ];
  assert.equal(
    resolvedRankDimensionMergeTargets(merges).get(sourceKey)?.key,
    targetKey
  );
  const target = {
    key: targetKey,
    searchEngine: "GOOGLE" as const,
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP" as const
  };
  const sources = await rankDimensionSources({
    rankDimensionMerge: { findMany: async () => merges }
  } as unknown as PrismaService, scope, target);
  assert.deepEqual(
    sources.map(({ key }) => key),
    [targetKey, sourceKey, intermediateKey]
  );
});

test("AI catalog exposes only position-tracking AI dimensions", async () => {
  let queryText = "";
  const catalog = await rawAiRankDimensionCatalog({
    $queryRaw: async (query: unknown) => {
      queryText = ((query as { strings?: readonly string[] }).strings ?? []).join(" ");
      return [{
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "2",
        regionLabel: null,
        language: "ru",
        device: "MOBILE"
      }];
    },
    rankDimensionMerge: { findMany: async () => [] }
  } as unknown as PrismaService, scope);

  assert.match(queryText, /FROM ai_answer_snapshots snapshot/u);
  assert.match(queryText, /snapshot\.position_tracking_enabled/u);
  assert.deepEqual(catalog.dimensions.map(({ key }) => key), [
    "YANDEX|RU|2|ru|MOBILE"
  ]);
});
