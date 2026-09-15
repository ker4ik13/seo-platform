import type {
  ProjectConnectorCredentialOption,
  RankCollectionPurpose,
  TrackingSearchEngine
} from "@seo-platform/contracts";

export interface ProviderUsageEstimate {
  readonly usage: string;
  readonly available: string;
}

export function frequencyRouteSource(
  sources: readonly ProjectConnectorCredentialOption[],
  keywordCount: number,
  typeCount: number,
  allowLowBalanceFallback: boolean
): ProjectConnectorCredentialOption | undefined {
  const primary = sources[0];
  if (!primary || !allowLowBalanceFallback) return primary;
  return sources.find((source) =>
    frequencySourceCanFund(source, keywordCount, typeCount)
  ) ?? primary;
}

export function frequencySourceCanFund(
  source: ProjectConnectorCredentialOption,
  keywordCount: number,
  typeCount: number
): boolean {
  return xmlStockFrequencyBalanceSufficient(source, keywordCount, typeCount);
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
    const requestCount = keywordCount * typeCount;
    return {
      usage: xmlStockUsageLabel(
        source,
        "WORDSTAT",
        requestCount,
        requestCount,
        uiLocale
      ),
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
  depth: 10 | 20 | 30 | 50 | 100,
  searchSource: "SEARCH_API" | "LIVE",
  yandexLiveMode?: "TURBO",
  _purpose: RankCollectionPurpose = "POSITION_TRACKING", uiLocale: string = "ru-RU"
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
        usage: xmlStockUsageLabel(
          source,
          "YANDEX_TURBO",
          minimumRequestCount,
          maximumRequestCount,
          uiLocale
        ),
        available: providerQuotaLabel(source, uiLocale)
      };
    }
    const requestsPerKeyword =
      searchEngine === "YANDEX" && searchSource === "SEARCH_API"
        ? 1
        : Math.ceil(depth / 10);
    const requestCount = keywordCount * requestsPerKeyword;
    const product = searchEngine === "GOOGLE"
      ? "GOOGLE_LIVE" as const
      : searchSource === "SEARCH_API"
        ? "YANDEX_SEARCH_API" as const
        : "YANDEX_LIVE" as const;
    return {
      usage: xmlStockUsageLabel(
        source,
        product,
        requestCount,
        requestCount,
        uiLocale
      ),
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

function xmlStockUsageLabel(
  source: ProjectConnectorCredentialOption,
  product: "YANDEX_SEARCH_API" | "YANDEX_LIVE" | "YANDEX_TURBO" | "GOOGLE_LIVE" | "WORDSTAT",
  minimumRequests: number,
  maximumRequests: number,
  uiLocale: string
): string {
  const quota = source.quota;
  const pricing = quota?.status === "AVAILABLE"
    ? quota.xmlStockPricing
    : undefined;
  const requestLabel = minimumRequests === maximumRequests
    ? `${formatInteger(minimumRequests, uiLocale)} запросов`
    : `${formatInteger(minimumRequests, uiLocale)}–${formatInteger(maximumRequests, uiLocale)} запросов`;
  if (!pricing) return `${requestLabel} XMLStock · цена обновится после проверки API`;
  const price = pricing.pricesPerThousand[product];
  const minimumCost = minimumRequests * Number(price) / 1_000;
  const maximumCost = maximumRequests * Number(price) / 1_000;
  const cost = minimumRequests === maximumRequests
    ? formatMoney(String(minimumCost), "RUB", uiLocale)
    : `${formatMoney(String(minimumCost), "RUB", uiLocale)}–${formatMoney(String(maximumCost), "RUB", uiLocale)}`;
  return `${xmlStockTariffLabel(pricing.tariffCode)} · ${price} ₽ за 1000 · ${requestLabel} · ${cost}`;
}

function xmlStockFrequencyBalanceSufficient(
  source: ProjectConnectorCredentialOption,
  keywordCount: number,
  typeCount: number
): boolean {
  if (source.provider !== "XMLSTOCK" || source.mode !== "BYOK_API_KEY") {
    return true;
  }
  const quota = source.quota;
  if (
    quota?.status !== "AVAILABLE" ||
    !quota.balance ||
    !quota.xmlStockPricing ||
    !Number.isSafeInteger(keywordCount) ||
    keywordCount < 1 ||
    !Number.isSafeInteger(typeCount) ||
    typeCount < 1
  ) return true;
  const balance = decimalUnits(quota.balance.amount);
  const pricePerThousand = decimalUnits(
    quota.xmlStockPricing.pricesPerThousand.WORDSTAT
  );
  return balance === undefined || pricePerThousand === undefined
    ? true
    : balance * 1_000n >=
        pricePerThousand * BigInt(keywordCount) * BigInt(typeCount);
}

function decimalUnits(value: string): bigint | undefined {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/u.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}

function xmlStockTariffLabel(
  tariff: "BASIC" | "OPTIMAL" | "MAXIMUM" | "PREMIUM" | "CUSTOM"
): string {
  if (tariff === "BASIC") return "Базовый тариф";
  if (tariff === "OPTIMAL") return "Оптимальный тариф";
  if (tariff === "MAXIMUM") return "Тариф Максимум";
  if (tariff === "PREMIUM") return "Премиум тариф";
  return "Тариф по ставкам аккаунта";
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
