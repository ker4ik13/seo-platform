import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalPublishRow,
  mergeCanonicalPublishRows,
  semanticImportPublishBatchSize,
  semanticImportPublishErrorIsRetryable,
  semanticImportPublishFailureCode,
  semanticImportPublishRetryExhausted
} from "./semantic-import-publisher.service.js";
import { SeoDataClientError } from "../seo-data/seo-data.client.js";

test("keeps a bounded retry window for production publish handovers", () => {
  assert.equal(semanticImportPublishRetryExhausted(9), false);
  assert.equal(semanticImportPublishRetryExhausted(10), true);
  assert.equal(semanticImportPublishRetryExhausted(11), true);
});

test("retries a temporary import command mismatch during a rolling deployment", () => {
  const invalid = new SeoDataClientError("INVALID_COMMAND", false);
  assert.equal(semanticImportPublishErrorIsRetryable(invalid), true);
  assert.equal(semanticImportPublishFailureCode(invalid), "SEO_DATA_COMMAND_INVALID");
  assert.equal(
    semanticImportPublishErrorIsRetryable(
      new SeoDataClientError("NOT_FOUND", false)
    ),
    false
  );
});

test("publishes rich KC4 rows in short transactions", () => {
  assert.equal(semanticImportPublishBatchSize(5_000, "KC4", 1), 1_000);
  assert.equal(semanticImportPublishBatchSize(5_000, "CSV", 1), 5_000);
  assert.equal(semanticImportPublishBatchSize(5_000, "KC4", 25), 400);
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

test("keeps merged KC4 history found state and position coherent", () => {
  const base = {
    sourceRowNumber: "1",
    textOriginal: "одинаковая фраза",
    textNormalized: "одинаковая фраза",
    normalizedHash: "f".repeat(64),
    language: "ru",
    customValues: {}
  } as const;
  const history = {
    source: "KEY_COLLECTOR" as const,
    searchEngine: "YANDEX" as const,
    countryCode: "RU",
    regionCode: "kc4-import",
    regionLabel: "Импорт Key Collector",
    language: "ru",
    device: "DESKTOP" as const,
    observedAt: "2026-08-18T00:00:00.000Z"
  };
  const merged = mergeCanonicalPublishRows([
    {
      ...base,
      positionHistory: [{ ...history, found: true, position: 36 }]
    },
    {
      ...base,
      sourceRowNumber: "2",
      positionHistory: [{ ...history, found: false }]
    }
  ]);

  assert.deepEqual(merged.positionHistory, [{
    ...history,
    found: true,
    position: 36
  }]);
  assert.ok(canonicalPublishRow(merged));
});

test("canonicalizes nested KC4 position fields before hashing a publish chunk", () => {
  const canonical = canonicalPublishRow({
    language: "ru",
    groupPath: ["Статьи", "Информационка"],
    positions: [
      {
        source: "KEY_COLLECTOR",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        observedAt: "2026-08-01T00:00:00.000Z",
        found: true,
        position: 7,
        rankingUrl: "https://example.com/page",
        serpResults: [{
          title: "Глубокий результат",
          rankingUrl: "https://example.com/deep",
          position: 43
        }],
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
      source: "KEY_COLLECTOR",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Москва",
      language: "ru",
      device: "DESKTOP",
      observedAt: "2026-08-01T00:00:00.000Z",
      searchEngine: "YANDEX",
      found: true,
      position: 7,
      rankingUrl: "https://example.com/page",
      serpResults: [{
        position: 43,
        rankingUrl: "https://example.com/deep",
        title: "Глубокий результат"
      }]
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
            source: "KEY_COLLECTOR",
            countryCode: "RU",
            regionCode: "213",
            regionLabel: "Москва",
            language: "ru",
            device: "DESKTOP",
            observedAt: "2026-08-01T00:00:00.000Z",
            searchEngine: "YANDEX",
            found: true,
            position: 7,
            rankingUrl: "https://example.com/page",
            serpResults: [{
              position: 43,
              rankingUrl: "https://example.com/deep",
              title: "Глубокий результат"
            }]
          },
          { searchEngine: "GOOGLE", found: false }
        ],
        customValues: {}
      }
    ])
  );
});

test("merges duplicate KC4 rows into one SERP result per position", () => {
  const base = {
    sourceRowNumber: "2",
    textOriginal: "продвижение сайта",
    textNormalized: "продвижение сайта",
    normalizedHash: "e".repeat(64),
    language: "ru",
    customValues: {}
  } as const;
  const merged = mergeCanonicalPublishRows([
    {
      ...base,
      groupPath: ["Первая папка"],
      positions: [{
        searchEngine: "YANDEX",
        found: true,
        position: 1,
        rankingUrl: "https://example.com/first",
        serpResults: [
          { position: 1, rankingUrl: "https://example.com/first" },
          { position: 43, rankingUrl: "https://example.com/deep" }
        ]
      }]
    },
    {
      ...base,
      sourceRowNumber: "9",
      groupPath: ["Вторая папка"],
      positions: [{
        searchEngine: "YANDEX",
        found: true,
        position: 1,
        rankingUrl: "https://example.com/first",
        serpResults: [
          {
            position: 1,
            rankingUrl: "https://example.com/first",
            title: "Главная"
          },
          { position: 43, rankingUrl: "https://example.com/deep" }
        ]
      }]
    }
  ]);

  assert.deepEqual(merged.positions?.[0]?.serpResults, [
    {
      position: 1,
      rankingUrl: "https://example.com/first",
      title: "Главная"
    },
    { position: 43, rankingUrl: "https://example.com/deep" }
  ]);
  assert.ok(canonicalPublishRow(merged));
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
