import type {
  RankJobSummary,
  RankOperationResultRow
} from "@seo-platform/contracts";

export function rankFailureReason(
  row: RankOperationResultRow,
  provider: RankJobSummary["provider"]
): string {
  const providerName = provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin";
  if (row.status === "CANCELLED") return "Сбор был отменён до получения результата";
  if (row.errorCode === "INVALID_CREDENTIAL") return `${providerName} отклонил API-ключ`;
  if (row.errorCode === "PROVIDER_RATE_LIMITED") return `${providerName} не снял ограничение запросов`;
  if (row.errorCode === "INVALID_PROVIDER_RESPONSE") return `${providerName} вернул некорректный ответ`;
  if (row.errorCode === "PROVIDER_PLAN_OR_REQUEST_REJECTED") return `Тариф или параметры запроса отклонены ${providerName}`;
  if (row.errorCode === "SUBMIT_OUTCOME_UNKNOWN") return "Не удалось подтвердить отправку запроса";
  if (row.errorCode === "PROVIDER_POLL_TIMEOUT") return `${providerName} не вернул полный результат за лимит попыток`;
  if (row.errorCode === "PROVIDER_UNAVAILABLE") return `${providerName} оставался недоступен до исчерпания попыток`;
  if ((row.pollAttempts ?? 0) >= 50) return "Результат не получен за 50 попыток";
  return "Провайдер не вернул пригодный результат";
}

export function rankPollAttempts(row: RankOperationResultRow): string {
  const value = row.pollAttempts;
  if (value === undefined) return "—";
  const mod100 = value % 100;
  const mod10 = value % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? "попыток"
    : mod10 === 1
      ? "попытка"
      : mod10 >= 2 && mod10 <= 4
        ? "попытки"
        : "попыток";
  return `${new Intl.NumberFormat("ru-RU").format(value)} ${noun}`;
}
