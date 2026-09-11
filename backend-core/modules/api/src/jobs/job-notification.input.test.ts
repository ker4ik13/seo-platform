import assert from "node:assert/strict";
import test from "node:test";
import { jobNotificationContent } from "./job-notification.controller.js";
import { jobNotificationInput } from "./job-notification.input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";

test("accepts a tenant-bound terminal job notification", () => {
  assert.deepEqual(jobNotificationInput(validInput()), validInput());
});

test("rejects mismatched idempotency and invalid progress", () => {
  assert.throws(() =>
    jobNotificationInput({
      ...validInput(),
      progressCurrent: 4,
      progressTotal: 3
    })
  );
  assert.throws(() =>
    jobNotificationInput({
      ...validInput(),
      idempotencyKey: `job-notification:${jobId}:FAILED_FINAL`
    })
  );
});

test("maps rank and frequency jobs to their result pages", () => {
  assert.deepEqual(
    jobNotificationContent(validInput()),
    {
      eventType: "FREQUENCY_COLLECTION",
      label: "Сбор частотности",
      deepLink: `/app/tasks/frequency/${jobId}`,
      severity: "INFO",
      title: "Сбор частотности: завершено",
      body: "Обработано: 3 из 3."
    }
  );
  const rank = jobNotificationContent({
    ...validInput(),
    jobType: "MANUAL_RANK_CHECK",
    status: "FAILED_FINAL",
    errorCode: "PROVIDER_UNAVAILABLE",
    idempotencyKey: `job-notification:${jobId}:FAILED_FINAL`
  });
  assert.equal(rank.eventType, "RANK_TRACKING");
  assert.equal(rank.deepLink, `/app/tasks/rank/${jobId}`);
  assert.equal(rank.severity, "CRITICAL");
  assert.equal(rank.title, "Проверка позиций: ошибка");
  assert.match(rank.body, /PROVIDER_UNAVAILABLE/u);
});

test("gives every SEO collection its own operation name and result route", () => {
  const cases = [
    ["WORDSTAT_FREQUENCY_COLLECTION", "Сбор частотности", "FREQUENCY_COLLECTION", "frequency"],
    ["WORDSTAT_SEASONALITY_COLLECTION", "Сбор сезонности", "FREQUENCY_COLLECTION", "frequency"],
    ["RANK_POSITION_TRACKING", "Проверка позиций", "RANK_TRACKING", "rank"],
    ["RANK_COMPETITOR_SERP", "Выдача конкурентов", "SERP_COLLECTION", "rank"],
    ["AI_ANSWER_COLLECTION", "Сбор ИИ-ответов", "SERP_COLLECTION", "ai-answer"],
    ["AI_COMPETITOR_SERP", "ИИ-выдача конкурентов", "SERP_COLLECTION", "ai-answer"],
    ["CLUSTERING_RUN", "Кластеризация запросов", "CLUSTERING", "clustering"],
    ["KEYS_SO_RESEARCH", "Анализ Keys.so", "MAGNET", "research"],
    ["WORDSTAT_KEYWORD_RESEARCH", "Парсинг Wordstat", "MAGNET", "research"]
  ] as const;

  for (const [jobType, label, eventType, resultKind] of cases) {
    const content = jobNotificationContent({ ...validInput(), jobType });
    assert.equal(content.title, `${label}: завершено`);
    assert.equal(content.eventType, eventType);
    assert.equal(content.deepLink, `/app/tasks/${resultKind}/${jobId}`);
  }
});

function validInput() {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobType: "FREQUENCY_COLLECTION",
    status: "COMPLETED" as const,
    progressCurrent: 3,
    progressTotal: 3,
    errorCode: null,
    idempotencyKey: `job-notification:${jobId}:COMPLETED`
  };
}
