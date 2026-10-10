import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSemanticPositionHistoryImportOptions,
  isSemanticPositionSnapshotHeader
} from "./semantic-imports.js";

test("wide bindings are bounded, canonical, URL-paired and reject overlapping/duplicate snapshots", () => {
  const base = { layout: "WIDE", searchEngine: "YANDEX", countryCode: "RU", regionCode: "213", regionLabel: "Москва", language: "ru", device: "DESKTOP" };
  const value = { ...base, dateColumns: [{ sourceIndex: 1, observedAt: "08.10.2026", rankingUrlSourceIndex: 2 }] };
  assert.equal(parseSemanticPositionHistoryImportOptions(value).dateColumns?.[0]?.observedAt, "2026-10-08T12:00:00.000Z");
  for (const extra of [
    { sourceIndex: 1, observedAt: "31.02.2026" },
    { sourceIndex: 1, observedAt: "08.10.2026", rankingUrlSourceIndex: 1 },
    { sourceIndex: 1, observedAt: "08.10.2026", secret: "not-allowed" },
  ]) assert.throws(() => parseSemanticPositionHistoryImportOptions({ ...base, dateColumns: [extra] }));
  assert.throws(() => parseSemanticPositionHistoryImportOptions({ ...base, dateColumns: [value.dateColumns[0], { sourceIndex: 3, observedAt: "08.10.2026" }] }));
  assert.throws(() => parseSemanticPositionHistoryImportOptions({ ...value, layout: "LONG" }));
});

test("parses an external single-snapshot position header", () => {
  assert.equal(
    isSemanticPositionSnapshotHeader("Яндекс:XML Desktop Москва [213]"),
    true
  );
  assert.equal(
    isSemanticPositionSnapshotHeader("Google: Live Mobile Санкт-Петербург [1011973]"),
    true
  );
  assert.equal(isSemanticPositionSnapshotHeader("Яндекс · Позиция"), false);
});

test("canonicalizes the optional default date for a one-snapshot import", () => {
  const result = parseSemanticPositionHistoryImportOptions({
    layout: "LONG",
    observedAt: "2026-09-16T12:00:00+00:00",
    searchEngine: "YANDEX",
    countryCode: "ru",
    regionCode: "213",
    regionLabel: " Москва ",
    language: "ru",
    device: "DESKTOP"
  });
  assert.equal(result.observedAt, "2026-09-16T12:00:00.000Z");
});
