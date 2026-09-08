import type {
  ProjectConnectorCredentialOption,
  RankCollectionPurpose,
  TrackingSearchEngine
} from "@seo-platform/contracts";

export interface ProviderUsageEstimate {
  readonly usage: string;
  readonly available: string;
}

export function frequencyProviderUsageEstimate(
  source: ProjectConnectorCredentialOption | undefined,
  keywordCount: number,
  typeCount: number, uiLocale: string = "ru-RU"
): ProviderUsageEstimate {
  if (!source) return unavailableEstimate();
  if (source.mode === "PLATFORM_PAID") {
    return platformTokenEstimate();
  }
  if (source.provider === "XMLSTOCK") {
    return {
      usage: `до ${formatInteger(keywordCount * typeCount, uiLocale)} запросов XMLStock`,
      available: providerQuotaLabel(source, uiLocale)
    };
  }
  if (source.provider === "ARSENKIN") {
    return {
      usage: `${formatInteger(keywordCount * typeCount, uiLocale)} лимитов Arsenkin`,
      available: providerQuotaLabel(source, uiLocale)
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
  yandexLiveMode?: "TURBO",
  purpose: RankCollectionPurpose = "POSITION_TRACKING", uiLocale: string = "ru-RU"
): ProviderUsageEstimate {
  if (!source) return unavailableEstimate();
  if (source.mode === "PLATFORM_PAID") {
    return platformTokenEstimate();
  }
  if (source.provider === "XMLSTOCK") {
    if (purpose === "COMPETITOR_SERP") {
      const requestCount = keywordCount;
      const pricePerThousand =
        searchEngine === "YANDEX" && searchSource === "SEARCH_API" ? 28 : 25;
      return {
        usage: `до ${formatInteger(requestCount, uiLocale)} запросов XMLStock · Топ-10 · от ${formatMoney(String(requestCount * pricePerThousand / 1_000), "RUB", uiLocale)}`,
        available: providerQuotaLabel(source, uiLocale)
      };
    }
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
          `${formatInteger(minimumRequestCount, uiLocale)}–${formatInteger(maximumRequestCount, uiLocale)} запросов XMLStock Turbo · повышенный тариф`,
        available: providerQuotaLabel(source, uiLocale)
      };
    }
    const requestsPerKeyword =
      searchEngine === "YANDEX" && searchSource === "SEARCH_API"
        ? 1
        : Math.ceil(depth / 10);
    const requestCount = keywordCount * requestsPerKeyword;
    const pricePerThousand =
      searchEngine === "YANDEX" && searchSource === "SEARCH_API" ? 28 : 25;
    return {
      usage: `до ${formatInteger(requestCount, uiLocale)} запросов XMLStock · от ${formatMoney(String(requestCount * pricePerThousand / 1_000), "RUB", uiLocale)}`,
      available: providerQuotaLabel(source, uiLocale)
    };
  }
  if (source.provider === "ARSENKIN") {
    const limitsPerKeyword = searchEngine === "GOOGLE"
      ? depth === 100 ? 5 : depth === 50 ? 3 : 2
      : 2;
    return {
      usage: `${formatInteger(keywordCount * limitsPerKeyword, uiLocale)} лимитов Arsenkin (${limitsPerKeyword} на запрос)`,
      available: providerQuotaLabel(source, uiLocale)
    };
  }
  return unavailableEstimate();
}

export function providerQuotaLabel(
  source: ProjectConnectorCredentialOption, uiLocale: string = "ru-RU"
): string {
  if (source.mode === "PLATFORM_PAID") {
    return "Баланс данных рабочей области";
  }
  const quota = source.quota;
  if (!quota || quota.status !== "AVAILABLE") {
    return "Квота обновится после проверки API";
  }
  if (quota.unit === "XMLSTOCK_REQUESTS") {
    const balance = quota.balance
      ? formatMoney(quota.balance.amount, quota.balance.currency, uiLocale)
      : undefined;
    const requests = `${formatInteger(quota.remaining, uiLocale)} запросов`;
    return balance ? `${balance} · ${requests}` : requests;
  }
  if (quota.unit === "ARSENKIN_LIMITS") {
    return `${formatInteger(quota.remaining, uiLocale)} лимитов`;
  }
  return `${formatInteger(quota.remaining, uiLocale)} API-запросов`;
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function formatMoney(amount: string, currency: "RUB", uiLocale: string = "ru-RU"): string {
  const value = Number(amount);
  return Number.isFinite(value)
    ? new Intl.NumberFormat(uiLocale, {
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
    available: "Баланс данных рабочей области"
  };
}
