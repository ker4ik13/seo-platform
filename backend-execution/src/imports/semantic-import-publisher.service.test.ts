import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalPublishRow,
  mergeCanonicalPublishRows,
  semanticImportPublishRetryExhausted
} from "./semantic-import-publisher.service.js";

test("stops scheduling a semantic publish after five claimed attempts", () => {
  assert.equal(semanticImportPublishRetryExhausted(4), false);
  assert.equal(semanticImportPublishRetryExhausted(5), true);
  assert.equal(semanticImportPublishRetryExhausted(6), true);
});

test("canonicalizes PostgreSQL JSON field order before hashing a publish chunk", () => {
  const storedJson = {
    language: "ru",
    groupPath: ["Коммерция"],
    frequencies: [{ type: "BASE", value: "120" }],
    customValues: {},
    textOriginal: "продвижение сайта",
    normalizedHash:
      "cacd6fa1a0ad9f9bac9c50c5c6bccd047a38d2d9775a2b0e7373b54cf67d677c",
    textNormalized: "продвижение сайта",
    sourceRowNumber: "2"
  };

  const canonical = canonicalPublishRow(storedJson);

  assert.ok(canonical);
  assert.deepEqual(Object.keys(canonical), [
    "sourceRowNumber",
    "textOriginal",
    "textNormalized",
    "normalizedHash",
    "language",
    "groupPath",
    "frequencies",
    "customValues"
  ]);
  assert.equal(
    sha256([canonical]),
    sha256([
      {
        sourceRowNumber: "2",
        textOriginal: "продвижение сайта",
        textNormalized: "продвижение сайта",
        normalizedHash:
          "cacd6fa1a0ad9f9bac9c50c5c6bccd047a38d2d9775a2b0e7373b54cf67d677c",
        language: "ru",
        groupPath: ["Коммерция"],
        frequencies: [{ type: "BASE", value: "120" }],
        customValues: {}
      }
    ])
  );
});

test("rejects non-string custom values and malformed optional fields", () => {
  const required = {
    sourceRowNumber: "1",
    textOriginal: "SEO",
    textNormalized: "seo",
    normalizedHash: "a".repeat(64),
    language: "ru",
    customValues: {}
  };

  assert.equal(
    canonicalPublishRow({
      ...required,
      customValues: { score: 42 }
    }),
    undefined
  );
  assert.equal(
    canonicalPublishRow({ ...required, targetUrl: 42 }),
    undefined
  );
});

test("preserves every Key Collector group membership for a duplicate phrase", () => {
  const baseRow = {
    sourceRowNumber: "7",
    textOriginal: "купить слона",
    textNormalized: "купить слона",
    normalizedHash: "b".repeat(64),
    language: "ru",
    priority: 70,
    isFavorite: true,
    intent: "TRANSACTIONAL",
    tags: ["приоритет"],
    customValues: { source: "Key Collector" }
  } as const;

  const merged = mergeCanonicalPublishRows([
    { ...baseRow, groupPath: ["Коммерция", "Москва"] },
    {
      ...baseRow,
      sourceRowNumber: "18",
      groupPath: ["Продажи"],
      tags: ["приоритет", "горячие"]
    }
  ]);

  assert.deepEqual(merged.groupPaths, [
    ["Коммерция", "Москва"],
    ["Продажи"]
  ]);
  assert.deepEqual(merged.tags, ["приоритет", "горячие"]);
  assert.equal(merged.priority, 70);
  assert.equal(merged.isFavorite, true);
  assert.equal(merged.intent, "TRANSACTIONAL");
  assert.deepEqual(Object.keys(merged), [
    "sourceRowNumber",
    "textOriginal",
    "textNormalized",
    "normalizedHash",
    "language",
    "priority",
    "isFavorite",
    "intent",
    "groupPaths",
    "tags",
    "customValues"
  ]);
});

test("canonicalizes nested KC4 position fields before hashing a publish chunk", () => {
  const canonical = canonicalPublishRow({
    language: "ru",
    groupPath: ["Статьи", "Информационка"],
    positions: [
      {
        found: true,
        position: 7,
        rankingUrl: "https://example.com/page",
        searchEngine: "YANDEX"
      },
      {
        found: false,
        searchEngine: "GOOGLE"
      }
    ],
    frequencies: [{ value: "120", type: "BASE" }],
    customValues: {},
    textOriginal: "продвижение сайта",
    normalizedHash: "c".repeat(64),
    textNormalized: "продвижение сайта",
    sourceRowNumber: "2"
  });

  assert.ok(canonical);
  assert.deepEqual(canonical.positions, [
    {
      searchEngine: "YANDEX",
      found: true,
      position: 7,
      rankingUrl: "https://example.com/page"
    },
    { searchEngine: "GOOGLE", found: false }
  ]);
  assert.deepEqual(canonical.frequencies, [
    { type: "BASE", value: "120" }
  ]);
  assert.equal(
    sha256([canonical]),
    sha256([
      {
        sourceRowNumber: "2",
        textOriginal: "продвижение сайта",
        textNormalized: "продвижение сайта",
        normalizedHash: "c".repeat(64),
        language: "ru",
        groupPath: ["Статьи", "Информационка"],
        frequencies: [{ type: "BASE", value: "120" }],
        positions: [
          {
            searchEngine: "YANDEX",
            found: true,
            position: 7,
            rankingUrl: "https://example.com/page"
          },
          { searchEngine: "GOOGLE", found: false }
        ],
        customValues: {}
      }
    ])
  );
});

test("canonicalizes nested manual history fields before hashing a publish chunk", () => {
  const canonical = canonicalPublishRow({
    language: "ru",
    customValues: {},
    textOriginal: "история позиции",
    normalizedHash: "d".repeat(64),
    textNormalized: "история позиции",
    sourceRowNumber: "5",
    positionHistory: [{
      found: true,
      device: "MOBILE",
      language: "ru",
      position: 7,
      observedAt: "2026-09-06T12:00:00.000Z",
      regionCode: "1011969",
      countryCode: "RU",
      regionLabel: "Москва",
      searchEngine: "GOOGLE"
    }]
  });

  assert.ok(canonical);
  assert.deepEqual(canonical.positionHistory, [{
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "1011969",
    regionLabel: "Москва",
    language: "ru",
    device: "MOBILE",
    observedAt: "2026-09-06T12:00:00.000Z",
    found: true,
    position: 7
  }]);
  assert.ok(canonical.positionHistory[0]);
  assert.deepEqual(Object.keys(canonical.positionHistory[0]), [
    "searchEngine",
    "countryCode",
    "regionCode",
    "regionLabel",
    "language",
    "device",
    "observedAt",
    "found",
    "position"
  ]);
});

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
