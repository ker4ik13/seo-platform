import assert from "node:assert/strict";
import test from "node:test";
import {
  compactOperationStatusLabel,
  operationStageLabel,
  operationStatusLabel
} from "./operation-status-presentation.ts";

test("keeps narrow drawer statuses short regardless of provider stage", () => {
  assert.equal(compactOperationStatusLabel("RUNNING"), "Выполняется");
  assert.equal(compactOperationStatusLabel("WAITING_RATE_LIMIT"), "Ожидает");
  assert.equal(compactOperationStatusLabel("COMPLETED"), "Готово");
  assert.equal(compactOperationStatusLabel("PARTIALLY_COMPLETED"), "Частично");
  assert.equal(compactOperationStatusLabel("private_internal_status"), "Неизвестно");
});

test("keeps retry waits understandable while explaining provider-specific stages", () => {
  assert.equal(
    operationStatusLabel("RETRY_SCHEDULED", "waiting_provider"),
    "Ожидает результат провайдера"
  );
  assert.equal(
    operationStatusLabel("RETRY_SCHEDULED", "waiting_provider_capacity"),
    "Ожидает свободный слот провайдера"
  );
  assert.equal(
    operationStatusLabel("RETRY_SCHEDULED"),
    "Ожидает"
  );
  assert.equal(operationStatusLabel("RETRY_SCHEDULED", "retry_scheduled"), "Ожидает");
});

test("does not expose an unknown internal stage in task details", () => {
  assert.equal(
    operationStageLabel("private_internal_stage", "RUNNING"),
    "Выполняется"
  );
  assert.equal(operationStageLabel("finished", "COMPLETED"), "Завершено");
});
