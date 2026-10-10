import assert from "node:assert/strict";
import test from "node:test";
import { importedPositionHistory, isPositionHistorySummary, positionHistoryDateColumns, positionHistoryMetadataHeader } from "./position-history-import.js";

const defaults = { searchEngine: "GOOGLE" as const, countryCode: "RU", regionCode: "1011969", regionLabel: "Москва", language: "ru", device: "DESKTOP" as const };

test("explicit wide bindings pair each date with its own URL and preserve mixed search engines", () => {
  const issues = new Set<string>();
  const points = importedPositionHistory(["term", "a", "b", "c", "d"], ["ключ", "9", "https://example.com/old", "2", "https://example.com/new"], {
    ...defaults, layout: "WIDE", dateColumns: [
      { sourceIndex: 1, rankingUrlSourceIndex: 2, observedAt: "2026-10-01T12:00:00.000Z" },
      { sourceIndex: 3, rankingUrlSourceIndex: 4, observedAt: "2026-10-01T12:00:00.000Z", context: { ...defaults, searchEngine: "YANDEX", regionCode: "213" } },
    ],
  }, issues);
  assert.deepEqual(points.map(point => [point.searchEngine, point.position, point.rankingUrl]), [
    ["GOOGLE", 9, "https://example.com/old"], ["YANDEX", 2, "https://example.com/new"],
  ]);
  assert.equal(issues.size, 0);
});

test("long metadata can be mapped from arbitrary headers and city codes are engine-specific", () => {
  const history = { ...defaults, layout: "LONG" as const };
  const mapping = { columns: [
    { sourceIndex: 0, target: "keyword.text" as const }, { sourceIndex: 1, target: "metric.observed_at" as const },
    { sourceIndex: 2, target: "context.search_engine" as const }, { sourceIndex: 3, target: "context.region" as const },
    { sourceIndex: 4, target: "context.device" as const }, { sourceIndex: 5, target: "ranking.position" as const },
  ], defaultLanguage: "ru", groupSeparator: "/", duplicatePolicy: "MERGE_NON_EMPTY" as const, createMissingKeywords: true, positionHistory: history };
  for (const [engine, regionCode] of [["Яндекс", "213"], ["Google", "1011969"]]) {
    const issues = new Set<string>();
    const points = importedPositionHistory(["A", "B", "C", "D", "E", "F"], ["ключ", "08.10.2026", engine!, "Москва", "Телефон", "8"], history, issues, mapping);
    assert.equal(points[0]?.regionCode, regionCode);
    assert.equal(points[0]?.device, "MOBILE");
    assert.equal(issues.size, 0);
  }
});

test("malformed dates are errors and blank long measurements do not create snapshots", () => {
  const issues = new Set<string>();
  assert.deepEqual(importedPositionHistory(["Запрос", "Дата", "Позиция"], ["ключ", "31.02.2026", "7"], { ...defaults, layout: "LONG" }, issues), []);
  assert.ok(issues.has("INVALID_OBSERVED_AT"));
  assert.deepEqual(importedPositionHistory(["Запрос", "Дата", "Позиция"], ["ключ", "08.10.2026", ""], { ...defaults, layout: "LONG" }, new Set()), []);
});

test("wide position history distinguishes missing measurements, not-found dashes and decimal integers", () => {
  const headers = ["Запросы", "2025-12-23", "30.12.2025", "2026/01/12", "2026-01-20"];
  assert.equal(positionHistoryDateColumns(headers).length, 4);
  const issues = new Set<string>();
  const points = importedPositionHistory(headers, ["ключ", "1.0", "", "–", "100,0"], defaults, issues);
  assert.deepEqual(points.map(({ observedAt, found, position }) => ({ observedAt, found, position })), [
    { observedAt: "2025-12-23T12:00:00.000Z", found: true, position: 1 },
    { observedAt: "2026-01-12T12:00:00.000Z", found: false, position: undefined },
    { observedAt: "2026-01-20T12:00:00.000Z", found: true, position: 100 }
  ]);
  assert.deepEqual([...issues], []);
});

test("attaches one imported ranking URL to found points in a wide history row", () => {
  const headers = ["Запрос", "URL из выдачи", "2026-09-08", "2026-09-14"];
  const issues = new Set<string>();
  const points = importedPositionHistory(
    headers,
    ["купить слона", "https://example.com/slony", "7", "—"],
    defaults,
    issues,
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "ranking.url" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: false,
      positionHistory: defaults
    }
  );
  assert.deepEqual(points, [
    {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011969",
      regionLabel: "Москва",
      language: "ru",
      device: "DESKTOP",
      observedAt: "2026-09-08T12:00:00.000Z",
      found: true,
      position: 7,
      rankingUrl: "https://example.com/slony"
    },
    {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011969",
      regionLabel: "Москва",
      language: "ru",
      device: "DESKTOP",
      observedAt: "2026-09-14T12:00:00.000Z",
      found: false
    }
  ]);
  assert.deepEqual([...issues], []);
});

test("Sonorita export metadata overrides defaults and validates one engine", () => {
  const headers = ["Фраза", "Поисковик", "Город", "Код региона", "Устройство", "Страна", "Язык", "2026-09-08"];
  const issues = new Set<string>();
  const points = importedPositionHistory(headers, ["ключ", "Google", "Санкт-Петербург", "1011973", "Телефон", "RU", "ru", "7"], defaults, issues);
  assert.deepEqual(points[0], { searchEngine: "GOOGLE", countryCode: "RU", regionCode: "1011973", regionLabel: "Санкт-Петербург", language: "ru", device: "MOBILE", observedAt: "2026-09-08T12:00:00.000Z", found: true, position: 7 });
  assert.ok(headers.slice(1, 7).every(positionHistoryMetadataHeader));
  assert.equal(isPositionHistorySummary("ТОП-30"), true);
  const wrongEngine = new Set<string>();
  assert.deepEqual(importedPositionHistory(headers, ["ключ", "Яндекс", "Москва", "213", "ПК", "RU", "ru", "5"], defaults, wrongEngine), []);
  assert.ok(wrongEngine.has("POSITION_HISTORY_CONTEXT_INVALID"));
});

test("empty exported row creates no snapshots and ignores placeholder metadata", () => {
  const issues = new Set<string>();
  assert.deepEqual(importedPositionHistory(["Фраза", "Код региона", "2026-09-08"], ["без замеров", "—", ""], defaults, issues), []);
  assert.deepEqual([...issues], []);
});

test("rejects explicit unknown engine and device metadata instead of replacing it with defaults", () => {
  const headers = ["Фраза", "Поисковик", "Устройство", "2026-09-08"];
  for (const values of [
    ["ключ", "Bing", "ПК", "5"],
    ["ключ", "Google", "Планшет", "5"]
  ]) {
    const issues = new Set<string>();
    assert.deepEqual(importedPositionHistory(headers, values, defaults, issues), []);
    assert.deepEqual([...issues], ["POSITION_HISTORY_CONTEXT_INVALID"]);
  }
});

test("imports long position rows with their own date, engine, region and ranking URL", () => {
  const headers = ["Запрос", "Дата", "Поисковик", "Город", "Код региона", "Устройство", "Позиция", "URL из выдачи"];
  const values = ["купить слона", "14.09.2026", "Google", "Москва", "1011969", "Телефон", "7", "https://example.com/slony"];
  const issues = new Set<string>();
  const points = importedPositionHistory(
    headers,
    values,
    { ...defaults, layout: "LONG" },
    issues,
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "metric.observed_at" },
        { sourceIndex: 2, target: "context.search_engine" },
        { sourceIndex: 3, target: "context.region" },
        { sourceIndex: 6, target: "ranking.position" },
        { sourceIndex: 7, target: "ranking.url" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: false,
      positionHistory: { ...defaults, layout: "LONG" }
    }
  );
  assert.deepEqual(points, [{
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "1011969",
    regionLabel: "Москва",
    language: "ru",
    device: "MOBILE",
    observedAt: "2026-09-14T12:00:00.000Z",
    found: true,
    position: 7,
    rankingUrl: "https://example.com/slony"
  }]);
  assert.deepEqual([...issues], []);
});

test("imports a one-snapshot external row with a manually selected date and context", () => {
  const issues = new Set<string>();
  const points = importedPositionHistory(
    ["Запрос", "Яндекс:XML Desktop Москва [213]", "Релевантная страница"],
    ["кабель кгтп расшифровка", "18", "https://example.com/catalog/kabel-kgtp/"],
    {
      ...defaults,
      layout: "LONG",
      observedAt: "2026-09-16T12:00:00.000Z",
      regionCode: "1011973",
      regionLabel: "Санкт-Петербург",
      device: "MOBILE"
    },
    issues,
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "ranking.position" },
        { sourceIndex: 2, target: "ranking.url" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: false,
      positionHistory: {
        ...defaults,
        layout: "LONG",
        observedAt: "2026-09-16T12:00:00.000Z",
        regionCode: "1011973",
        regionLabel: "Санкт-Петербург",
        device: "MOBILE"
      }
    }
  );
  assert.deepEqual(points, [{
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "1011973",
    regionLabel: "Санкт-Петербург",
    language: "ru",
    device: "MOBILE",
    observedAt: "2026-09-16T12:00:00.000Z",
    found: true,
    position: 18,
    rankingUrl: "https://example.com/catalog/kabel-kgtp/"
  }]);
  assert.deepEqual([...issues], []);
});

test("reports an invalid ranking URL without dropping a valid long position", () => {
  const issues = new Set<string>();
  const points = importedPositionHistory(
    ["Запрос", "Дата", "Позиция", "URL из выдачи"],
    ["купить слона", "14.09.2026", "7", "javascript:alert(1)"],
    { ...defaults, layout: "LONG" },
    issues,
    {
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "metric.observed_at" },
        { sourceIndex: 2, target: "ranking.position" },
        { sourceIndex: 3, target: "ranking.url" }
      ],
      defaultLanguage: "ru",
      groupSeparator: "/",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: false,
      positionHistory: { ...defaults, layout: "LONG" }
    }
  );
  assert.equal(points[0]?.position, 7);
  assert.equal(points[0]?.rankingUrl, undefined);
  assert.deepEqual([...issues], ["INVALID_RANKING_URL"]);
});
