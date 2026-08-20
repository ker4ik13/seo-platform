const statusLabels: Readonly<Record<string, string>> = {
  PREPARING: "Подготовка",
  QUEUED: "В очереди",
  RUNNING: "Выполняется",
  WAITING_RATE_LIMIT: "Ждёт лимита",
  RETRY_SCHEDULED: "Повтор после ошибки",
  FAILED_RETRYABLE: "Ожидает повтора",
  CANCEL_REQUESTED: "Останавливается",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
  PARTIALLY_COMPLETED: "Завершено частично",
  FAILED: "Ошибка",
  FAILED_FINAL: "Ошибка",
  ACTION_REQUIRED: "Требует внимания",
  EXPIRED: "Истекло",
  READY_TO_IMPORT: "Готово к импорту",
  IMPORT_QUEUED: "Импорт в очереди",
  IMPORTING: "Импортируется"
};

const stageLabels: Readonly<Record<string, string>> = {
  clustering: "Подготовка кластеризации",
  submitting: "Отправка в Arsenkin",
  provider_poll: "Ожидает результат Arsenkin",
  provider_capacity: "Ожидает свободный слот Arsenkin",
  proposal_ready: "Черновик готов к применению",
  submit_ambiguous: "Нужна сверка задачи у провайдера",
  credential_required: "Нужно проверить подключение",
  retry_scheduled: "Запланирован повтор",
  failed: "Кластеризация завершилась ошибкой",
  cancelled: "Кластеризация отменена",
  waiting_provider: "Ожидает результат провайдера",
  waiting_provider_capacity: "Ожидает свободный слот провайдера",
  finished: "Завершено"
};

export function operationStatusLabel(
  status: string,
  stage?: string
): string {
  if (status === "RETRY_SCHEDULED" && stage) {
    return stageLabels[stage] ?? statusLabels[status] ?? status;
  }
  return statusLabels[status] ?? status;
}

export function operationStageLabel(
  stage: string | undefined,
  status: string
): string {
  return (stage && stageLabels[stage]) ?? operationStatusLabel(status, stage);
}
