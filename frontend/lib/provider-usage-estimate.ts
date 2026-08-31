import type {
  ProjectConnectorCredentialOption,
  TrackingSearchEngine
} from "@seo-platform/contracts";

export interface ProviderUsageEstimate {
  readonly usage: string;
  readonly available: string;
}

export function frequencyProviderUsageEstimate(
  source: ProjectConnectorCredentialOption | undefined,
  keywordCount: number,
  typeCount: number
): ProviderUsageEstimate {
  if (!source) return unavailableEstimate();
  if (source.mode === "PLATFORM_PAID") {
    return platformTokenEstimate();
  }
  if (source.provider === "XMLSTOCK") {
    return {
      usage: `до ${formatInteger(keywordCount * typeCount)} запросов XMLStock`,
      available: providerQuotaLabel(source)
    };
  }
  if (source.provider === "ARSENKIN") {
    return {
      usage: keywordCount > 0 ? "1 пакет Arsenkin" : "0 пакетов",
      available: providerQuotaLabel(source)
    };
  }
  return unavailableEstimate();
}

export function rankProviderUsageEstimate(
  source: ProjectConnectorCredentialOption | undefined,
  keywordCount: number,
  searchEngine: TrackingSearchEngine,
  depth: 30 | 50 | 100,
  searchSource: "SEARCH_API" | "LIVE",
  yandexLiveMode?: "TURBO"
): ProviderUsageEstimate {
  if (!source) return unavailableEstimate();
  if (source.mode === "PLATFORM_PAID") {
    return platformTokenEstimate();
  }
  if (source.provider === "XMLSTOCK") {
    if (
      yandexLiveMode === "TURBO" &&
      searchEngine === "YANDEX" &&
      searchSource === "LIVE"
    ) {
      const minimumRequestCount =
        keywordCount * Math.ceil(depth / 50);
      const maximumRequestCount =
        keywordCount * Math.ceil(depth / 10);
      return {
        usage:
          `${formatInteger(minimumRequestCount)}–${formatInteger(maximumRequestCount)} запросов XMLStock Turbo · повышенный тариф`,
        available: providerQuotaLabel(source)
      };
    }
    const requestsPerKeyword =
      searchEngine === "YANDEX" && searchSource === "SEARCH_API"
        ? 1
        : Math.ceil(depth / 10);
    const requestCount = keywordCount * requestsPerKeyword;
    const pricePerThousand =
      searchEngine === "YANDEX" && searchSource === "SEARCH_API" ? 24 : 12;
    return {
      usage: `до ${formatInteger(requestCount)} запросов XMLStock · от ${formatMoney(String(requestCount * pricePerThousand / 1_000), "RUB")}`,
      available: providerQuotaLabel(source)
    };
  }
  if (source.provider === "ARSENKIN") {
    const limitsPerKeyword = searchEngine === "GOOGLE"
      ? depth === 100 ? 5 : depth === 50 ? 3 : 2
      : 2;
    return {
      usage: `${formatInteger(keywordCount * limitsPerKeyword)} лимитов Arsenkin (${limitsPerKeyword} на запрос)`,
      available: providerQuotaLabel(source)
    };
  }
  return unavailableEstimate();
}

export function providerQuotaLabel(
  source: ProjectConnectorCredentialOption
): string {
  if (source.mode === "PLATFORM_PAID") {
    return "Внутренние токены workspace";
  }
  const quota = source.quota;
  if (!quota || quota.status !== "AVAILABLE") {
    return "Квота обновится после проверки API";
  }
  if (quota.unit === "XMLSTOCK_REQUESTS") {
    const balance = quota.balance
      ? formatMoney(quota.balance.amount, quota.balance.currency)
      : undefined;
    const requests = `${formatInteger(quota.remaining)} запросов`;
    return balance ? `${balance} · ${requests}` : requests;
  }
  if (quota.unit === "ARSENKIN_LIMITS") {
    return `${formatInteger(quota.remaining)} лимитов`;
  }
  return `${formatInteger(quota.remaining)} API-запросов`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMoney(amount: string, currency: "RUB"): string {
  const value = Number(amount);
  return Number.isFinite(value)
    ? new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
      }).format(value)
    : `${amount} ₽`;
}

function unavailableEstimate(): ProviderUsageEstimate {
  return {
    usage: "Недоступно",
    available: "Квота недоступна"
  };
}

function platformTokenEstimate(): ProviderUsageEstimate {
  return {
    usage: "Точная стоимость после расчёта",
    available: "Внутренние токены workspace"
  };
}
