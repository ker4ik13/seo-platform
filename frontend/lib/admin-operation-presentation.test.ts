import assert from "node:assert/strict";
import test from "node:test";
import { adminOperationName, adminSearchProductLabel, operationFailureLabel } from "./admin-operation-presentation.ts";

test("distinguishes frequency from seasonality and names the complete search product", () => {
  assert.equal(adminOperationName({ type: "FREQUENCY_COLLECTION", frequencyMode: "SEASONALITY" }), "Сезонность Wordstat");
  assert.equal(adminOperationName({ type: "FREQUENCY_COLLECTION", frequencyMode: "FREQUENCY" }), "Сбор частотности");
  assert.equal(adminOperationName({ type: "FREQUENCY_COLLECTION" }), "Частотность и сезонность");
  assert.equal(adminOperationName({ type: "AI_ANSWER_COLLECTION" }), "Сбор ИИ-ответов");
  assert.equal(adminSearchProductLabel({ type: "FREQUENCY_COLLECTION", searchEngine: "YANDEX" }), "Яндекс Wordstat");
  assert.equal(adminSearchProductLabel({ type: "MANUAL_RANK_CHECK", provider: "XMLSTOCK", searchEngine: "YANDEX", searchSource: "LIVE" }), "Яндекс Live");
  assert.equal(adminSearchProductLabel({ type: "MANUAL_RANK_CHECK", provider: "XMLSTOCK", searchEngine: "GOOGLE", searchSource: "LIVE" }), "Google XML");
  assert.equal(adminSearchProductLabel({ type: "MANUAL_RANK_CHECK", provider: "XMLSTOCK", searchEngine: "YANDEX", searchSource: "SEARCH_API" }), "Яндекс XML");
});

test("renders provider balance failures as actionable text", () => {
  assert.match(operationFailureLabel("PROVIDER_LOW_BALANCE"), /Недостаточно средств/u);
  assert.match(operationFailureLabel("ITEMS_FAILED"), /подробности в логе/u);
  assert.equal(operationFailureLabel("PROVIDER_CONCURRENCY_LIMITED"), "Ожидает свободный слот");
});
