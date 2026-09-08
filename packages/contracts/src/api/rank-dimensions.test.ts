import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSemanticRankColumnKey,
  parseSemanticRankComparisonInput,
  parseSemanticRankComparisonItems,
  parseSemanticRankDimensionCatalog,
  parseSemanticRankDimensionKey,
  semanticRankColumnKey,
  semanticRankDimensionKey
} from "./rank-dimensions.js";

const keywordId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const contextId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const dimension = { searchEngine: "YANDEX" as const, countryCode: "RU", regionCode: "213", regionLabel: "Москва", language: "ru", device: "MOBILE" as const };
const key = semanticRankDimensionKey(dimension);

test("rank dimension and dynamic column identities are canonical", () => {
  assert.equal(key, "YANDEX|RU|213|ru|MOBILE");
  assert.deepEqual(parseSemanticRankDimensionKey(key), { key, searchEngine: "YANDEX", countryCode: "RU", regionCode: "213", language: "ru", device: "MOBILE" });
  const encodedRegionKey = semanticRankDimensionKey({ ...dimension, regionCode: "city|part" });
  assert.equal(encodedRegionKey, "YANDEX|RU|city%7Cpart|ru|MOBILE");
  assert.equal(parseSemanticRankDimensionKey(encodedRegionKey)?.regionCode, "city|part");
  const column = semanticRankColumnKey(key, "position");
  assert.deepEqual(parseSemanticRankColumnKey(column), { dimension: parseSemanticRankDimensionKey(key), metric: "position" });
  for (const invalid of ["", "YANDEX|ru|213|ru|MOBILE", "YANDEX|RU|bad%20part|ru|MOBILE", `${key}:other`]) assert.equal(parseSemanticRankDimensionKey(invalid), undefined);
});

test("catalog and comparison parsers enforce exact tenant-independent scope", () => {
  assert.deepEqual(parseSemanticRankDimensionCatalog({ dimensions: [{ key, ...dimension }], truncated: false }), { dimensions: [{ key, ...dimension }], truncated: false });
  const scope = parseSemanticRankComparisonInput({ keywordIds: [keywordId], dimensionKeys: [key] });
  const rows = parseSemanticRankComparisonItems([{ keywordId, dimensionKey: key, searchEngine: "YANDEX", found: true, position: 7, previousPosition: 11, rankingUrl: "https://example.com/a", observedAt: "2026-09-08T10:00:00.000Z", snapshotId, trackingContextId: contextId, configurationVersion: 2, jobId, provider: "MANUAL_IMPORT", depth: 100 }], scope);
  assert.equal(rows[0]?.position, 7);
  assert.throws(() => parseSemanticRankComparisonInput({ keywordIds: Array.from({ length: 84 }, () => keywordId), dimensionKeys: Array.from({ length: 24 }, () => key) }));
  assert.throws(() => parseSemanticRankComparisonItems([{ ...rows[0], keywordId: snapshotId }], scope));
});
