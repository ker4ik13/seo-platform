const statusLabels: Readonly<Record<string, string>> = {
  PREPARING: "Подготовка",
  QUEUED: "В очереди",
  RUNNING: "Выполняется",
  WAITING_RATE_LIMIT: "Ждёт лимита",
  RETRY_SCHEDULED: "Ожидает",
  FAILED_RETRYABLE: "Ожидает",
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
  retry_scheduled: "Ожидает",
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

/** Compact labels for the narrow operation drawer; technical stages stay in details. */
export function compactOperationStatusLabel(status: string): string {
  if (status === "COMPLETED" || status === "READY_TO_IMPORT") return "Готово";
  if (status === "PARTIALLY_COMPLETED") return "Частично";
  if (status === "CANCELLED") return "Отменено";
  if (status === "CANCEL_REQUESTED") return "Останавливается";
  if (["FAILED", "FAILED_FINAL", "ACTION_REQUIRED", "EXPIRED"].includes(status)) return "Ошибка";
  if (status === "QUEUED" || status === "IMPORT_QUEUED") return "В очереди";
  if (["WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(status)) return "Ожидает";
  if (["PREPARING", "RUNNING", "IMPORTING"].includes(status)) return "Выполняется";
  return "Неизвестно";
}

export function operationStageLabel(
  stage: string | undefined,
  status: string
): string {
  return (stage && stageLabels[stage]) ?? operationStatusLabel(status, stage);
}

export function arsenkinProviderProgressLabel(percent: number | undefined, locale = "ru-RU"): string | undefined {
  return percent !== undefined && Number.isInteger(percent) && percent >= 0 && percent <= 100
    ? locale.startsWith("en")
      ? `Arsenkin: ${percent}% · current task`
      : `Arsenkin: ${percent}% · текущая задача`
    : undefined;
}
