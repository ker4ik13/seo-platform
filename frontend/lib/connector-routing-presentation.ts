import type {
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope,
  IntegrationProvider
} from "@seo-platform/contracts";

const scopeLabels: Readonly<Record<ConnectorRoutingScope, string>> = {
  WORKSPACE_DEFAULT: "Рабочая область",
  PROJECT_OVERRIDE: "Проект",
  WORKSPACE_FALLBACK: "Fallback рабочей области"
};

const reasonLabels: Readonly<Record<string, string>> = {
  LOW_BALANCE: "недостаточно баланса",
  RATE_LIMITED: "лимит запросов",
  CREDENTIAL_UNAVAILABLE: "подключение недоступно",
  CAPABILITY_MISMATCH: "операция не поддерживается",
  RETRYABLE_PROVIDER_ERROR: "временная ошибка провайдера",
  PROVIDER_AUTHENTICATION_FAILED: "ошибка авторизации",
  PROVIDER_RATE_LIMITED: "лимит запросов",
  PROVIDER_TEMPORARY_FAILURE: "временная ошибка провайдера",
  PROVIDER_RESPONSE_INVALID: "некорректный ответ провайдера",
  INTERNAL_ERROR: "внутренняя ошибка"
};

export function connectorProviderLabel(provider: IntegrationProvider): string {
  if (provider === "XMLSTOCK") return "XMLStock";
  if (provider === "ARSENKIN") return "Arsenkin Tools";
  return "Keys.so";
}

export function connectorRoutingScopeLabel(scope: ConnectorRoutingScope): string {
  return scopeLabels[scope];
}

export function connectorAttemptReasonLabel(reasonCode: string): string {
  return reasonLabels[reasonCode] ?? "ошибка подключения";
}

export function connectorAttemptOutcomeLabel(
  outcome: ConnectorOperationAttemptSummary["outcome"]
): string {
  if (outcome === "SUCCEEDED") return "успешно";
  if (outcome === "FALLBACK") return "переключение";
  if (outcome === "FAILED") return "ошибка";
  return "выбран";
}

export function connectorRouteTrail(
  attempts: readonly ConnectorOperationAttemptSummary[] | undefined
): string | undefined {
  if (!attempts || attempts.length === 0) return undefined;
  return attempts
    .map((attempt) => {
      const state = attempt.reasonCode
        ? connectorAttemptReasonLabel(attempt.reasonCode)
        : connectorAttemptOutcomeLabel(attempt.outcome);
      return `${connectorProviderLabel(attempt.provider)} — ${state}`;
    })
    .join(" → ");
}

export function hasConnectorFallback(
  attempts: readonly ConnectorOperationAttemptSummary[] | undefined
): boolean {
  return attempts?.some(({ outcome }) => outcome === "FALLBACK") ?? false;
}
