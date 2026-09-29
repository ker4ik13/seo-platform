import type {
  ConnectorOperationAttemptSummary,
  RankOperationSourceUsage
} from "@seo-platform/contracts";

export function rankSourceLabel(
  sources: readonly RankOperationSourceUsage[] | undefined,
  uiLocale: string
): string {
  const source = sources?.find((item) => item.selected) ?? sources?.[0];
  if (!source) {
    return sources === undefined
      ? uiLocale.startsWith("en") ? "Source temporarily unavailable" : "Источник временно недоступен"
      : uiLocale.startsWith("en") ? "Connection unknown" : "Подключение не определено";
  }
  return `${source.label}${source.displayHint ? ` · ${source.displayHint}` : ""}`;
}

export function hasRankRouting(
  attempts: readonly ConnectorOperationAttemptSummary[] | undefined,
  sources: readonly RankOperationSourceUsage[] | undefined
): boolean {
  return (attempts?.length ?? 0) > 1 || (sources?.length ?? 0) > 1;
}

export function rankRoutingLines(
  attempts: readonly ConnectorOperationAttemptSummary[] | undefined,
  sources: readonly RankOperationSourceUsage[] | undefined,
  uiLocale: string
): Readonly<{ attemptLines: readonly string[]; sourceLines: readonly string[] }> {
  return {
    attemptLines: (attempts ?? []).map((attempt) =>
      `${attempt.sequence}. ${attempt.provider}: ${routeOutcome(attempt.outcome, uiLocale)}` +
      (attempt.reasonCode ? ` — ${routeReason(attempt.reasonCode, uiLocale)}` : "")
    ),
    sourceLines: (sources ?? []).map((source) =>
      `${source.provider} · ${source.label}${source.displayHint ? ` · ${source.displayHint}` : ""}: ` +
      `${new Intl.NumberFormat(uiLocale).format(BigInt(source.requestCount))} ` +
      (uiLocale.startsWith("en") ? "requests" : "запросов")
    )
  };
}

function routeOutcome(value: string, uiLocale: string): string {
  const labels = uiLocale.startsWith("en")
    ? { SELECTED: "selected", SUCCEEDED: "succeeded", FALLBACK: "fell back", FAILED: "failed" }
    : { SELECTED: "выбран", SUCCEEDED: "успешен", FALLBACK: "переключились дальше", FAILED: "ошибка" };
  return (labels as Record<string, string>)[value] ?? value;
}

function routeReason(value: string, uiLocale: string): string {
  const labels = uiLocale.startsWith("en") ? {
    CREDENTIAL_UNAVAILABLE: "connection unavailable",
    LOW_BALANCE: "insufficient balance",
    RATE_LIMITED: "request limit",
    RETRYABLE_PROVIDER_ERROR: "temporary provider error"
  } : {
    CREDENTIAL_UNAVAILABLE: "подключение недоступно",
    LOW_BALANCE: "недостаточно баланса",
    RATE_LIMITED: "лимит запросов",
    RETRYABLE_PROVIDER_ERROR: "временная ошибка провайдера"
  };
  return (labels as Record<string, string>)[value] ?? value;
}
