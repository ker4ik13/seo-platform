import assert from "node:assert/strict";
import test from "node:test";
import { importedPositionHistory, isPositionHistorySummary, positionHistoryDateColumns, positionHistoryMetadataHeader } from "./position-history-import.js";

const defaults = { searchEngine: "GOOGLE" as const, countryCode: "RU", regionCode: "1011969", regionLabel: "Москва", language: "ru", device: "DESKTOP" as const };

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
