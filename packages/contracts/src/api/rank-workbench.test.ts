import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreateRankDimensionMergeInput,
  parseRankDimensionMergeSettings,
  parseDeleteRankDimensionHistoryInput,
  parseRankPositionReport,
  parseRankPositionReportInput,
  parseSerpWorkbenchReport,
  parseSerpWorkbenchInput
} from "./rank-workbench.js";
import { semanticRankDimensionKey } from "./rank-dimensions.js";

const keywordId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const dimension = {
  searchEngine: "YANDEX" as const,
  countryCode: "RU",
  regionCode: "213",
  language: "ru",
  device: "DESKTOP" as const
};
const dimensionKey = semanticRankDimensionKey(dimension);

test("parses a bounded daily position report command", () => {
  assert.deepEqual(parseRankPositionReportInput({
    dimensionKey,
    observedFrom: "2026-08-01T00:00:00.000Z",
    observedBefore: "2026-09-01T00:00:00.000Z",
    dateLimit: 31,
    groupIds: [keywordId],
    search: "  купить   бетон ",
    limit: 100,
    sort: "CHANGE_DESC",
    mode: "AI"
  }), {
    mode: "AI",
    dimensionKey,
    observedFrom: "2026-08-01T00:00:00.000Z",
    observedBefore: "2026-09-01T00:00:00.000Z",
    dateLimit: 31,
    groupIds: [keywordId],
    search: "купить бетон",
    limit: 100,
    sort: "CHANGE_DESC"
  });
  assert.equal(parseRankPositionReportInput({
    dimensionKey,
    observedFrom: "2026-08-01T00:00:00.000Z",
    observedBefore: "2026-09-01T00:00:00.000Z",
    dateLimit: 31,
    limit: 100,
    sort: "QUERY_ASC"
  }).mode, "SEO");
  assert.throws(() => parseRankPositionReportInput({
    dimensionKey,
    observedFrom: "2026-08-01T00:00:00.000Z",
    observedBefore: "2026-09-01T00:00:00.000Z",
    dateLimit: 31,
    limit: 100,
    sort: "QUERY_ASC",
    mode: "BOTH"
  }));
});

test("rejects more than five SERP comparison dimensions", () => {
  assert.throws(() => parseSerpWorkbenchInput({
    dimensionKeys: Array.from({ length: 6 }, (_, index) =>
      semanticRankDimensionKey({ ...dimension, regionCode: String(200 + index) })
    ),
    limit: 50
  }));
});

test("keeps ordinary and AI SERP inside the same dimension", () => {
  const report = parseSerpWorkbenchReport({
    dimensions: [{ key: dimensionKey, ...dimension }],
    rows: [{
      keywordId,
      version: 1,
      query: "купить диван",
      language: "ru",
      tags: [],
      snapshots: [{
        dimensionKey,
        snapshotId,
        observedAt: "2026-09-09T12:00:00.000Z",
        provider: "XMLSTOCK",
        results: [{ position: 1, url: "https://organic.example/" }]
      }],
      aiSnapshots: [{
        dimensionKey,
        snapshotId: "01900000-0000-7000-8000-000000000003",
        observedAt: "2026-09-09T12:01:00.000Z",
        provider: "ARSENKIN",
        results: [{ position: 1, url: "https://ai.example/" }]
      }]
    }],
    page: { hasNext: false, totalApprox: 1 }
  });
  assert.equal(report.rows[0]?.snapshots[0]?.results[0]?.url, "https://organic.example/");
  assert.equal(report.rows[0]?.aiSnapshots[0]?.results[0]?.url, "https://ai.example/");
});

test("validates every position report cell and its date scope", () => {
  const report = parseRankPositionReport({
    dimension: { key: dimensionKey, ...dimension, regionLabel: "Москва" },
    dates: ["2026-08-31", "2026-08-30"],
    summary: {
      keywordCount: 1,
      measuredCount: 1,
      foundCount: 1,
      notFoundCount: 0,
      improvedCount: 0,
      declinedCount: 0,
      unchangedCount: 0,
      newCount: 1,
      lostCount: 0,
      top3Count: 1,
      top10Count: 1,
      top30Count: 1,
      averagePosition: 2
    },
    trend: [{ date: "2026-08-31", measured: 1, found: 1, top3: 1, top10: 1, top30: 1, averagePosition: 2 }],
    rows: [{
      keywordId,
      version: 1,
      query: "купить бетон",
      language: "ru",
      createdAt: "2026-08-01T12:00:00.000Z",
      frequencies: [
        { type: "BASE", value: "120" },
        { type: "EXACT", value: "45" },
        { type: "FIXED", value: "18" }
      ],
      cells: [{
        date: "2026-08-31",
        snapshotId,
        observedAt: "2026-08-31T12:00:00.000Z",
        found: true,
        position: 2,
        rankingUrl: "https://example.test/beton",
        siteResultCount: 1
      }]
    }],
    page: { hasNext: false, totalApprox: 1 }
  });
  assert.equal(report.rows[0]?.cells[0]?.position, 2);
  assert.deepEqual(report.rows[0]?.frequencies.map(({ type }) => type), ["BASE", "EXACT", "FIXED"]);
  assert.deepEqual(report.dates, ["2026-08-31", "2026-08-30"]);
  const importedWithoutUrl = parseRankPositionReport({
    ...report,
    rows: [{
      ...report.rows[0],
      groupPath: null,
      targetUrl: null,
      cells: [{ ...report.rows[0]!.cells[0], rankingUrl: null }]
    }]
  });
  assert.equal(importedWithoutUrl.rows[0]?.cells[0]?.position, 2);
  assert.equal(importedWithoutUrl.rows[0]?.cells[0]?.rankingUrl, undefined);
  assert.throws(() => parseRankPositionReport({
    ...report,
    rows: [{ ...report.rows[0], cells: [{ ...report.rows[0]!.cells[0], date: "2026-08-29" }] }]
  }));
  assert.throws(() => parseRankPositionReport({
    ...report,
    dates: [...report.dates].reverse()
  }));
});

test("requires an explicit destructive history confirmation", () => {
  assert.deepEqual(parseDeleteRankDimensionHistoryInput({
    dimensionKey,
    confirmation: "DELETE"
  }), { dimensionKey, confirmation: "DELETE" });
  assert.throws(() => parseDeleteRankDimensionHistoryInput({
    dimensionKey,
    confirmation: "yes"
  }));
});

test("validates rank-dimension merge commands and settings", () => {
  const targetKey = semanticRankDimensionKey({
    ...dimension,
    regionCode: "2"
  });
  assert.deepEqual(parseCreateRankDimensionMergeInput({
    sourceDimensionKey: dimensionKey,
    targetDimensionKey: targetKey
  }), {
    sourceDimensionKey: dimensionKey,
    targetDimensionKey: targetKey
  });
  const settings = parseRankDimensionMergeSettings({
    dimensions: [
      { key: dimensionKey, ...dimension, regionLabel: "Импорт Key Collector" },
      { key: targetKey, ...dimension, regionCode: "2", regionLabel: "Москва" }
    ],
    merges: [{
      id: snapshotId,
      source: { key: dimensionKey, ...dimension, regionLabel: "Импорт Key Collector" },
      target: { key: targetKey, ...dimension, regionCode: "2", regionLabel: "Москва" },
      version: 1,
      createdAt: "2026-09-09T12:00:00.000Z"
    }]
  });
  assert.equal(settings.merges[0]?.target.regionLabel, "Москва");
  assert.throws(() => parseCreateRankDimensionMergeInput({
    sourceDimensionKey: dimensionKey,
    targetDimensionKey: dimensionKey
  }));
});
