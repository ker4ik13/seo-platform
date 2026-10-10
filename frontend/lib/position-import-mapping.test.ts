import assert from "node:assert/strict";
import test from "node:test";
import { initialPositionHistoryColumns, positionHistoryMappingError, spreadsheetColumnLetter } from "./position-import-mapping.ts";

test("date headers suggest explicit per-date URL bindings while arbitrary columns remain editable", () => {
  const defaults = { searchEngine: "YANDEX" as const, countryCode: "RU", regionCode: "213", regionLabel: "Москва", language: "ru", device: "DESKTOP" as const };
  const headers = ["Запрос", "06.10.2026", "URL · 06.10.2026", "Google · 08.10.2026", "Google URL · 08.10.2026"];
  const columns = initialPositionHistoryColumns(headers.map((sourceName, index) => ({ sourceName, index, suggestedTarget: "ignore", confidence: 0 })), defaults);
  assert.equal(columns.length, 2);
  assert.equal(columns[0]?.rankingUrlSourceIndex, 2);
  assert.equal(columns[1]?.rankingUrlSourceIndex, 4);
  assert.equal(columns[1]?.context?.searchEngine, "GOOGLE");
  assert.equal(positionHistoryMappingError({ ...defaults, layout: "WIDE", dateColumns: columns }, [{ sourceIndex: 0, target: "keyword.text" }]), undefined);
  assert.ok(positionHistoryMappingError({ ...defaults, layout: "WIDE", dateColumns: [] }, []));
  assert.deepEqual([0, 25, 26, 51, 52, 702].map(spreadsheetColumnLetter), ["A", "Z", "AA", "AZ", "BA", "AAA"]);
});
