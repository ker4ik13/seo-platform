import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticRankComparisonItem } from "@seo-platform/contracts";
import { mergeRankComparisonItems } from "./rank-comparison-cache.ts";


function item(keywordId: string, position: number): SemanticRankComparisonItem {
  return {
    keywordId,
    dimensionKey: "YANDEX:RU:213:ru:DESKTOP",
    snapshotId: "01900000-0000-7000-8000-000000000010",
    trackingContextId: "01900000-0000-7000-8000-000000000011",
    configurationVersion: 1,
    jobId: "01900000-0000-7000-8000-000000000012",
    searchEngine: "YANDEX",
    found: true,
    position,
    observedAt: "2026-09-14T12:00:00.000Z",
    provider: "XMLSTOCK",
    depth: 100,
    siteResultCount: 1
  };
}

test("keeps resolved rank cells across virtual viewport requests", () => {
  const first = item("01900000-0000-7000-8000-000000000001", 7);
  const second = item("01900000-0000-7000-8000-000000000002", 12);
  const updated = item(first.keywordId, 5);
  const key = (value: SemanticRankComparisonItem) => `${value.keywordId}:${value.dimensionKey}`;
  const merged = mergeRankComparisonItems(
    new Map([[key(first), first]]),
    new Map([[key(second), second], [key(updated), updated]])
  );
  assert.equal(merged.get(key(first))?.position, 5);
  assert.equal(merged.get(key(second))?.position, 12);
  assert.equal(merged.size, 2);
});
