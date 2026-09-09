import assert from "node:assert/strict";
import test from "node:test";
import {
  frequencyCollectionCompactTitle,
  frequencyCollectionParameters,
  frequencyCollectionTitle
} from "./frequency-operation-presentation.ts";

test("keeps frequency and seasonality operation names tied to their payload", () => {
  assert.equal(frequencyCollectionTitle({ mode: "FREQUENCY" }), "Сбор частотности");
  assert.equal(frequencyCollectionCompactTitle({ mode: "FREQUENCY", types: ["BASE", "EXACT"] }), "Частотность · Базовая + Фразовая");
  assert.equal(frequencyCollectionTitle({ mode: "SEASONALITY" }), "Сбор сезонности");
  assert.equal(frequencyCollectionCompactTitle({ mode: "SEASONALITY", types: ["BASE"] }), "Сезонность Wordstat");
  assert.equal(frequencyCollectionParameters({
    mode: "SEASONALITY",
    types: ["BASE"],
    seasonality: {
      granularity: "MONTH",
      observedFrom: "2026-01-01",
      observedThrough: "2026-12-31"
    }
  }), "По месяцам · 2026-01-01 — 2026-12-31");
});
