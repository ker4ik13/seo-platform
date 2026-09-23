import type {
  ProjectConnectorCredentialOption,
  RankCollectionPurpose,
  TrackingSearchEngine
} from "@seo-platform/contracts";

export interface ProviderUsageEstimate {
  readonly usage: string;
  readonly available: string;
  readonly tariff?: string;
  readonly requestRange?: string;
  readonly costRange?: string;
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
  if (!source) return unavailableEstimate(uiLocale);
  if (source.mode === "PLATFORM_PAID") {
    return platformTokenEstimate(uiLocale);
  }
  if (source.provider === "XMLSTOCK") {
    const requestCount = keywordCount * typeCount;
    return {
      ...xmlStockUsageEstimate(
        source,
        "WORDSTAT",
        requestCount,
        requestCount,
        uiLocale
      ),
    };
  }
  if (source.provider === "ARSENKIN") {
    const limits = formatInteger(keywordCount * typeCount, uiLocale);
    const unit = english(uiLocale) ? "Arsenkin credits" : "лимитов Arsenkin";
    return {
      usage: `${limits} ${unit}`,
      available: providerQuotaLabel(source, uiLocale),
      tariff: english(uiLocale) ? "Arsenkin plan" : "Тариф Arsenkin",
      requestRange: `${limits} ${english(uiLocale) ? "credits" : "лимитов"}`,
      costRange: `${limits} ${english(uiLocale) ? "credits" : "лимитов"}`
    };
  }
  return unavailableEstimate(uiLocale);
}

export function rankProviderUsageEstimate(
  source: ProjectConnectorCredentialOption | undefined,
  keywordCount: number,
  searchEngine: TrackingSearchEngine,
  depth: 10 | 20 | 30 | 50 | 100,
  searchSource: "SEARCH_API" | "LIVE",
  yandexLiveMode?: "TURBO",
  _purpose: RankCollectionPurpose = "POSITION_TRACKING",
  uiLocale: string = "ru-RU",
  xmlStockDepthMode: "STRICT_DEPTH" | "STOP_AFTER_FOUND" = "STRICT_DEPTH"
): ProviderUsageEstimate {
  if (!source) return unavailableEstimate(uiLocale);
  if (source.mode === "PLATFORM_PAID") {
    return platformTokenEstimate(uiLocale);
  }
  if (source.provider === "XMLSTOCK") {
    if (
      yandexLiveMode === "TURBO" &&
      searchEngine === "YANDEX" &&
      searchSource === "LIVE"
    ) {
      const minimumRequestCount =
        keywordCount * (xmlStockDepthMode === "STOP_AFTER_FOUND"
          ? 1
          : Math.ceil(depth / 50));
      const maximumRequestCount =
        keywordCount * Math.ceil(depth / 10);
      return {
        ...xmlStockUsageEstimate(
          source,
          "YANDEX_TURBO",
          minimumRequestCount,
          maximumRequestCount,
          uiLocale
        ),
      };
    }
    const requestsPerKeyword =
      searchEngine === "YANDEX" && searchSource === "SEARCH_API"
        ? 1
        : Math.ceil(depth / 10);
    const maximumRequestCount = keywordCount * requestsPerKeyword;
    const minimumRequestCount =
      xmlStockDepthMode === "STOP_AFTER_FOUND" &&
      searchSource === "LIVE"
        ? keywordCount
        : maximumRequestCount;
    const product = searchEngine === "GOOGLE"
      ? "GOOGLE_LIVE" as const
      : searchSource === "SEARCH_API"
        ? "YANDEX_SEARCH_API" as const
        : "YANDEX_LIVE" as const;
    return {
      ...xmlStockUsageEstimate(
        source,
        product,
        minimumRequestCount,
        maximumRequestCount,
        uiLocale
      ),
    };
  }
  if (source.provider === "ARSENKIN") {
    const limitsPerKeyword = searchEngine === "GOOGLE"
      ? depth === 100 ? 5 : depth === 50 ? 3 : 2
      : 2;
    const limits = formatInteger(keywordCount * limitsPerKeyword, uiLocale);
    return {
      usage: english(uiLocale)
        ? `${limits} Arsenkin credits (${limitsPerKeyword} per keyword)`
        : `${limits} лимитов Arsenkin (${limitsPerKeyword} на запрос)`,
      available: providerQuotaLabel(source, uiLocale),
      tariff: english(uiLocale) ? "Arsenkin plan" : "Тариф Arsenkin",
      requestRange: `${limits} ${english(uiLocale) ? "credits" : "лимитов"}`,
      costRange: `${limits} ${english(uiLocale) ? "credits" : "лимитов"}`
    };
  }
  return unavailableEstimate(uiLocale);
}

function xmlStockUsageEstimate(
  source: ProjectConnectorCredentialOption,
  product: "YANDEX_SEARCH_API" | "YANDEX_LIVE" | "YANDEX_TURBO" | "GOOGLE_LIVE" | "WORDSTAT",
  minimumRequests: number,
  maximumRequests: number,
  uiLocale: string
): ProviderUsageEstimate {
  const quota = source.quota;
  const pricing = quota?.status === "AVAILABLE"
    ? quota.xmlStockPricing
    : undefined;
  const requestLabel = minimumRequests === maximumRequests
    ? `${formatInteger(minimumRequests, uiLocale)} ${english(uiLocale) ? "requests" : "запросов"}`
    : english(uiLocale)
      ? `from ${formatInteger(minimumRequests, uiLocale)} to ${formatInteger(maximumRequests, uiLocale)} requests`
      : `от ${formatInteger(minimumRequests, uiLocale)} до ${formatInteger(maximumRequests, uiLocale)} запросов`;
  const available = providerQuotaLabel(source, uiLocale);
  if (!pricing) {
    const pendingPrice = english(uiLocale)
      ? "price updates after API validation"
      : "цена обновится после проверки API";
    const pendingTariff = english(uiLocale)
      ? "Plan updates after API validation"
      : "Тариф обновится после проверки API";
    const pendingCost = english(uiLocale)
      ? "Price updates after API validation"
      : "Цена обновится после проверки API";
    return {
      usage: `${requestLabel} XMLStock · ${pendingPrice}`,
      available,
      tariff: pendingTariff,
      requestRange: requestLabel,
      costRange: pendingCost
    };
  }
  const price = pricing.pricesPerThousand[product];
  const minimumCost = minimumRequests * Number(price) / 1_000;
  const maximumCost = maximumRequests * Number(price) / 1_000;
  const cost = minimumRequests === maximumRequests
    ? formatMoney(String(minimumCost), "RUB", uiLocale)
    : english(uiLocale)
      ? `from ${formatMoney(String(minimumCost), "RUB", uiLocale)} to ${formatMoney(String(maximumCost), "RUB", uiLocale)}`
      : `от ${formatMoney(String(minimumCost), "RUB", uiLocale)} до ${formatMoney(String(maximumCost), "RUB", uiLocale)}`;
  const tariff = english(uiLocale)
    ? `${xmlStockTariffLabel(pricing.tariffCode, uiLocale)} · ${formatMoney(price, "RUB", uiLocale)} per 1,000`
    : `${xmlStockTariffLabel(pricing.tariffCode, uiLocale)} · ${price} ₽ за 1000`;
  return {
    usage: `${tariff} · ${requestLabel} · ${cost}`,
    available,
    tariff,
    requestRange: requestLabel,
    costRange: cost
  };
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
  tariff: "BASIC" | "OPTIMAL" | "MAXIMUM" | "PREMIUM" | "CUSTOM",
  uiLocale: string
): string {
  if (english(uiLocale)) {
    if (tariff === "BASIC") return "Basic plan";
    if (tariff === "OPTIMAL") return "Optimal plan";
    if (tariff === "MAXIMUM") return "Maximum plan";
    if (tariff === "PREMIUM") return "Premium plan";
    return "Account rate plan";
  }
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
    return english(uiLocale)
      ? "Workspace data balance"
      : "Баланс данных рабочей области";
  }
  const quota = source.quota;
  if (!quota || quota.status !== "AVAILABLE") {
    return english(uiLocale)
      ? "Quota updates after API validation"
      : "Квота обновится после проверки API";
  }
  if (quota.unit === "XMLSTOCK_REQUESTS") {
    const balance = quota.balance
      ? formatMoney(quota.balance.amount, quota.balance.currency, uiLocale)
      : undefined;
    const requests = `${formatInteger(quota.remaining, uiLocale)} ${english(uiLocale) ? "requests" : "запросов"}`;
    return balance ? `${balance} · ${requests}` : requests;
  }
  if (quota.unit === "ARSENKIN_LIMITS") {
    return `${formatInteger(quota.remaining, uiLocale)} ${english(uiLocale) ? "credits" : "лимитов"}`;
  }
  return `${formatInteger(quota.remaining, uiLocale)} ${english(uiLocale) ? "API requests" : "API-запросов"}`;
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

function unavailableEstimate(uiLocale: string): ProviderUsageEstimate {
  const unavailable = english(uiLocale) ? "Unavailable" : "Недоступно";
  return {
    usage: unavailable,
    available: english(uiLocale) ? "Quota unavailable" : "Квота недоступна",
    tariff: unavailable,
    costRange: unavailable
  };
}

function platformTokenEstimate(uiLocale: string): ProviderUsageEstimate {
  const cost = english(uiLocale)
    ? "Exact cost after calculation"
    : "Точная стоимость после расчёта";
  return {
    usage: cost,
    available: english(uiLocale)
      ? "Workspace data balance"
      : "Баланс данных рабочей области",
    tariff: english(uiLocale) ? "Platform" : "Платформа",
    costRange: cost
  };
}

function english(uiLocale: string): boolean {
  return uiLocale.toLowerCase().startsWith("en");
}
