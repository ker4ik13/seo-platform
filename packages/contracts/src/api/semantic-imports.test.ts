import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSemanticPositionHistoryImportOptions,
  isSemanticPositionSnapshotHeader
} from "./semantic-imports.js";

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
