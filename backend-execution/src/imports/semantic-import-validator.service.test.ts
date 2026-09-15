import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticImportMapping } from "@seo-platform/contracts";
import {
  KC4_POSITION_HISTORY_HEADER,
  KC4_SERP_RESULTS_HEADER
} from "./kc4-parser.js";
import {
  canonicalImportRow,
  semanticImportValidationDestination
} from "./semantic-import-validator.service.js";

const mapping: SemanticImportMapping = {
  columns: [
    { sourceIndex: 0, target: "keyword.text" },
    { sourceIndex: 1, target: "group.path" },
    { sourceIndex: 2, target: "page.target_url" },
    { sourceIndex: 3, target: "frequency.exact" },
    { sourceIndex: 4, target: "keyword.tags" },
    { sourceIndex: 5, target: "ranking.position" },
    { sourceIndex: 6, target: "custom", customName: "Score" }
  ],
  defaultLanguage: "ru",
  groupSeparator: ">",
  duplicatePolicy: "SKIP_EXISTING",
  createMissingKeywords: true
};

test("publishes a fully mapped native KC4 immediately after validation", () => {
  const capacity = {
    billingPlanCode: "TEAM",
    billingPlanVersion: 3,
    storedKeywordsLimit: 2_000_000n,
    keywordsPerProjectLimit: 2_000_000n,
    foldersPerProjectLimit: 20_000n,
    trackedContextPairsLimit: 50_000n
  };
  assert.deepEqual(
    semanticImportValidationDestination(
      { sourceFormat: "KC4", ...capacity },
      { uniqueKeywordsToProcess: "42" }
    ),
    { status: "READY_TO_PUBLISH", stage: "publish_queued" }
  );
  assert.deepEqual(
    semanticImportValidationDestination(
      { sourceFormat: "XLSX", ...capacity },
      { uniqueKeywordsToProcess: "42" }
    ),
    { status: "AWAITING_CONFIRMATION", stage: "validation_ready" }
  );
  assert.deepEqual(
    semanticImportValidationDestination(
      {
        sourceFormat: "KC4",
        billingPlanCode: null,
        billingPlanVersion: null,
        storedKeywordsLimit: null,
        keywordsPerProjectLimit: null,
        foldersPerProjectLimit: null,
        trackedContextPairsLimit: null
      },
      { uniqueKeywordsToProcess: "42" }
    ),
    { status: "AWAITING_CONFIRMATION", stage: "validation_ready" }
  );
});

test("builds a canonical publish row without losing unsupported values", () => {
  const issues = new Set<string>();
  const result = canonicalImportRow(
    2n,
    [
      "SEO",
      "Маркетинг > SEO",
      "https://example.com/seo",
      "1 200",
      "важное;продажи",
      "7",
      "42"
    ],
    [
      "Фраза",
      "Группа",
      "URL",
      "Точная частотность",
      "Теги",
      "Позиция",
      "Score"
    ],
    mapping,
    {
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "a".repeat(64),
      language: "ru"
    },
    issues
  );

  assert.deepEqual(result.groupPath, ["Маркетинг", "SEO"]);
  assert.deepEqual(result.frequencies, [{ type: "EXACT", value: "1200" }]);
  assert.deepEqual(result.tags, ["важное", "продажи"]);
  assert.equal(result.customValues.Score, "42");
  assert.equal(result.customValues["Imported: Позиция"], "7");
  assert.deepEqual([...issues], ["TRACKING_CONTEXT_REQUIRED"]);
});

test("keeps a valid keyword while reporting invalid optional values", () => {
  const issues = new Set<string>();
  const result = canonicalImportRow(
    3n,
    ["SEO", "", "javascript:alert(1)", "not-a-number"],
    ["Фраза", "Группа", "URL", "Точная частотность"],
    {
      ...mapping,
      columns: mapping.columns.slice(0, 4)
    },
    {
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "a".repeat(64),
      language: "ru"
    },
    issues
  );

  assert.equal(result.targetUrl, undefined);
  assert.equal(result.frequencies, undefined);
  assert.deepEqual(
    new Set(issues),
    new Set(["INVALID_TARGET_URL", "INVALID_FREQUENCY"])
  );
});

test("preserves native KC4 hierarchy and imports search engine positions", () => {
  const issues = new Set<string>();
  const result = canonicalImportRow(
    4n,
    [
      "SEO",
      JSON.stringify(["Корень", "Раздел / услуги", "Подраздел"]),
      "25",
      "-2",
      "https://example.com/yandex-result",
      "2147483647",
      "0",
      "",
      JSON.stringify([
        {
          source: "KEY_COLLECTOR",
          searchEngine: "YANDEX",
          countryCode: "RU",
          regionCode: "kc4-import",
          regionLabel: "Импорт Key Collector",
          language: "ru",
          device: "DESKTOP",
          observedAt: "2026-08-01T12:00:00.000Z",
          found: true,
          position: 31,
          rankingUrl: "https://example.com/history"
        },
        {
          source: "KEY_COLLECTOR",
          searchEngine: "YANDEX",
          countryCode: "RU",
          regionCode: "kc4-import",
          regionLabel: "Импорт Key Collector",
          language: "ru",
          device: "DESKTOP",
          observedAt: "2026-08-01T12:00:00.000Z",
          found: false
        }
      ]),
      JSON.stringify([{
        searchEngine: "YANDEX",
        results: [
          {
            position: 1,
            rankingUrl: "https://example.com/first",
            title: "Первый результат"
          },
          {
            position: 43,
            rankingUrl: "https://example.com/second"
          }
        ]
      }])
    ],
    [
      "Фраза",
      "Группа",
      "Яндекс · Позиция",
      "Яндекс · Изменение позиции",
      "Яндекс · URL выдачи",
      "Google · Позиция",
      "Google · Изменение позиции",
      "Google · URL выдачи",
      KC4_POSITION_HISTORY_HEADER,
      KC4_SERP_RESULTS_HEADER
    ],
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "group.path" },
        { sourceIndex: 2, target: "ranking.position" }
      ],
      defaultLanguage: "ru",
      // A persisted delimiter from an earlier CSV import must not flatten a
      // native KC4 tree: KC4 paths always use the parser's slash separator.
      groupSeparator: " > ",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: true
    },
    {
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "a".repeat(64),
      language: "ru"
    },
    issues,
    { sourceFormat: "KC4" }
  );

  assert.deepEqual(result.groupPath, [
    "Корень",
    "Раздел / услуги",
    "Подраздел"
  ]);
  assert.deepEqual(result.positions, [
    {
      searchEngine: "YANDEX",
      found: true,
      position: 25,
      previousPosition: 27,
      rankingUrl: "https://example.com/yandex-result",
      serpResults: [
        {
          position: 1,
          rankingUrl: "https://example.com/first",
          title: "Первый результат"
        },
        {
          position: 43,
          rankingUrl: "https://example.com/second"
        }
      ]
    },
    { searchEngine: "GOOGLE", found: false }
  ]);
  assert.deepEqual(result.positionHistory, [{
    source: "KEY_COLLECTOR",
    searchEngine: "YANDEX",
    countryCode: "RU",
    regionCode: "kc4-import",
    regionLabel: "Импорт Key Collector",
    language: "ru",
    device: "DESKTOP",
    observedAt: "2026-08-01T12:00:00.000Z",
    found: true,
    position: 31,
    rankingUrl: "https://example.com/history"
  }]);
  assert.deepEqual(result.customValues, {});
  assert.deepEqual([...issues], []);
});

test("preserves a deeply nested XLSX path from one group column", () => {
  const issues = new Set<string>();
  const groupPath = Array.from(
    { length: 10 },
    (_, index) => `Уровень ${index + 1}`
  );
  const result = canonicalImportRow(
    5n,
    ["SEO", groupPath.join("/")],
    ["Фраза", "Группа"],
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "group.path" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: true
    },
    {
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "c".repeat(64),
      language: "ru"
    },
    issues,
    { sourceFormat: "XLSX" }
  );

  assert.deepEqual(result.groupPath, groupPath);
  assert.deepEqual([...issues], []);
});

test("maps independently selectable keyword fields and both search engines", () => {
  const issues = new Set<string>();
  const result = canonicalImportRow(
    5n,
    [
      "SEO audit",
      "37",
      "2",
      "https://example.com/yandex",
      "11",
      "-3",
      "https://example.com/google",
      "83",
      "да",
      "нет",
      "Проверить страницу",
      "Коммерческий"
    ],
    [
      "Фраза",
      "Яндекс · Позиция",
      "Яндекс · Изменение позиции",
      "Яндекс · URL выдачи",
      "Google · Позиция",
      "Google · Изменение позиции",
      "Google · URL выдачи",
      "Приоритет",
      "Избранное",
      "Отслеживается",
      "Заметка",
      "Интент"
    ],
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "ranking.yandex.position" },
        { sourceIndex: 2, target: "ranking.yandex.change" },
        { sourceIndex: 3, target: "ranking.yandex.url" },
        { sourceIndex: 4, target: "ranking.google.position" },
        { sourceIndex: 5, target: "ranking.google.change" },
        { sourceIndex: 6, target: "ranking.google.url" },
        { sourceIndex: 7, target: "keyword.priority" },
        { sourceIndex: 8, target: "keyword.favorite" },
        { sourceIndex: 9, target: "keyword.tracked" },
        { sourceIndex: 10, target: "keyword.note" },
        { sourceIndex: 11, target: "keyword.intent" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "OVERWRITE_MAPPED",
      createMissingKeywords: true
    },
    {
      textOriginal: "SEO audit",
      textNormalized: "seo audit",
      normalizedHash: "b".repeat(64),
      language: "ru"
    },
    issues
  );

  assert.equal(result.priority, 83);
  assert.equal(result.isFavorite, true);
  assert.equal(result.isTracked, false);
  assert.equal(result.note, "Проверить страницу");
  assert.equal(result.intent, "COMMERCIAL");
  assert.deepEqual(result.positions, [
    {
      searchEngine: "YANDEX",
      found: true,
      position: 37,
      previousPosition: 35,
      rankingUrl: "https://example.com/yandex"
    },
    {
      searchEngine: "GOOGLE",
      found: true,
      position: 11,
      previousPosition: 14,
      rankingUrl: "https://example.com/google"
    }
  ]);
  assert.deepEqual([...issues], []);
});
