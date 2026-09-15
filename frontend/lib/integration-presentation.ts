import type {
  IntegrationCapability,
  IntegrationCredentialMode,
  IntegrationCredentialStatus,
  IntegrationProvider
} from "@seo-platform/contracts";

export interface IntegrationStatusPresentation {
  readonly label: string;
  readonly tone: "active" | "danger" | "muted" | "pending" | "warning";
}

export function integrationProviderLabel(
  provider: IntegrationProvider
): string {
  const labels: Readonly<Record<IntegrationProvider, string>> = {
    XMLSTOCK: "XMLStock",
    ARSENKIN: "Arsenkin Tools",
    KEYS_SO: "Keys.so"
  };
  return labels[provider];
}

export function integrationCapabilityLabel(
  capability: IntegrationCapability
): string {
  const labels: Readonly<Record<IntegrationCapability, string>> = {
    SERP_RANK_TRACKING: "Съём позиций",
    SERP_COLLECTION: "Поисковая выдача",
    WORDSTAT: "Wordstat",
    CLUSTERING: "Кластеризация",
    INDEXATION: "Индексация",
    KEYWORD_RESEARCH: "Парсинг Wordstat",
    COMPETITOR_RESEARCH: "Конкуренты"
  };
  return labels[capability];
}

export function integrationCredentialModeLabel(
  mode: IntegrationCredentialMode
): string {
  const labels: Readonly<Record<IntegrationCredentialMode, string>> = {
    BYOK_API_KEY: "Собственный API-ключ",
    BYOK_OAUTH: "Собственный OAuth",
    PLATFORM_INCLUDED: "Включено в тариф",
    PLATFORM_PAID: "Баланс платформы",
    FALLBACK_PLATFORM_PAID: "Резерв платформы"
  };
  return labels[mode];
}

export function integrationCredentialStatusPresentation(
  status: IntegrationCredentialStatus
): IntegrationStatusPresentation {
  const presentations: Readonly<
    Record<IntegrationCredentialStatus, IntegrationStatusPresentation>
  > = {
    PENDING_VERIFICATION: {
      label: "Ожидает проверки",
      tone: "pending"
    },
    ACTIVE: { label: "Активно", tone: "active" },
    DEGRADED: { label: "Нестабильно", tone: "warning" },
    RATE_LIMITED: { label: "Лимит запросов", tone: "warning" },
    LOW_BALANCE: { label: "Низкий баланс", tone: "warning" },
    EXPIRED: { label: "Истёк", tone: "danger" },
    REVOKED: { label: "Отозван", tone: "danger" },
    INVALID: { label: "Некорректный", tone: "danger" },
    DISABLED: { label: "Отключён", tone: "muted" }
  };
  return presentations[status];
}
