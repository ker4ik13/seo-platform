import assert from "node:assert/strict";
import test from "node:test";
import {
  aiAnswerCollectionTitle,
  isCompetitorCollection,
  rankCollectionDepthLabel,
  rankCollectionTitle
} from "./operation-collection-purpose.ts";

test("presents competitor SERP as a distinct fixed Top-10 operation", () => {
  const operation = { purpose: "COMPETITOR_SERP" as const };

  assert.equal(isCompetitorCollection(operation), true);
  assert.equal(rankCollectionTitle(operation), "Выдача конкурентов · Топ-10");
  assert.equal(rankCollectionDepthLabel(operation, 30), "Топ-10");
  assert.equal(aiAnswerCollectionTitle(operation), "ИИ-выдача конкурентов");
});

test("keeps legacy collections in position-tracking presentation", () => {
  const operation = {};

  assert.equal(isCompetitorCollection(operation), false);
  assert.equal(rankCollectionTitle(operation), "Проверка позиций");
  assert.equal(rankCollectionDepthLabel(operation, 50), "Топ-50");
  assert.equal(aiAnswerCollectionTitle(operation), "Сбор ИИ-ответов");
});
