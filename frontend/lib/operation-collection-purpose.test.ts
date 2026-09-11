import assert from "node:assert/strict";
import test from "node:test";
import {
  aiAnswerCollectionTitle,
  isCompetitorCollection,
  keywordResearchCollectionTitle,
  notificationOperationLabel,
  operationResultTitleFromNotification,
  rankCollectionDepthLabel,
  rankCollectionTitle
} from "./operation-collection-purpose.ts";

test("presents competitor SERP with its selected depth", () => {
  const operation = { purpose: "COMPETITOR_SERP" as const, depth: 50 };

  assert.equal(isCompetitorCollection(operation), true);
  assert.equal(rankCollectionTitle(operation), "Выдача конкурентов · Топ-50");
  assert.equal(rankCollectionDepthLabel(operation, 50), "Топ-50");
  assert.equal(aiAnswerCollectionTitle(operation), "ИИ-выдача конкурентов");
});

test("keeps legacy collections in position-tracking presentation", () => {
  const operation = {};

  assert.equal(isCompetitorCollection(operation), false);
  assert.equal(rankCollectionTitle(operation), "Проверка позиций");
  assert.equal(rankCollectionDepthLabel(operation, 50), "Топ-50");
  assert.equal(aiAnswerCollectionTitle(operation), "Сбор ИИ-ответов");
});

test("distinguishes competitor research from Wordstat expansion", () => {
  assert.equal(keywordResearchCollectionTitle({ source: "KEYS_SO" }), "Анализ Keys.so");
  assert.equal(
    keywordResearchCollectionTitle({ source: "ARSENKIN_WORDSTAT" }),
    "Парсинг Wordstat"
  );
});

test("keeps the exact operation name when a terminal notification opens its result", () => {
  assert.equal(
    notificationOperationLabel(
      "Выдача конкурентов: завершено частично",
      "Операция"
    ),
    "Выдача конкурентов"
  );
  assert.equal(
    operationResultTitleFromNotification(
      "rank",
      "Выдача конкурентов: завершено"
    ),
    "Выдача конкурентов"
  );
  assert.equal(
    operationResultTitleFromNotification(
      "ai-answer",
      "ИИ-выдача конкурентов: ошибка"
    ),
    "ИИ-выдача конкурентов"
  );
  assert.equal(
    operationResultTitleFromNotification("crawl", "Неизвестное уведомление"),
    "Технический аудит"
  );
});
