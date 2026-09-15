import type {
  XmlStockOperationProduct,
  XmlStockOperationUsageSummary,
  XmlStockPricingSummary,
  XmlStockTariffCode
} from "@seo-platform/contracts";
import { parseXmlStockOperationUsageSummary } from "@seo-platform/contracts";

const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u;
const COUNT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

const KNOWN_TARIFFS: readonly Readonly<{
  code: Exclude<XmlStockTariffCode, "CUSTOM">;
  yandexSearchApi: string;
  yandexLive: string;
  googleLive: string;
  wordstat: string;
}>[] = [
  {
    code: "BASIC",
    yandexSearchApi: "28",
    yandexLive: "25",
    googleLive: "25",
    wordstat: "25"
  },
  {
    code: "OPTIMAL",
    yandexSearchApi: "27",
    yandexLive: "20",
    googleLive: "20",
    wordstat: "23"
  },
  {
    code: "MAXIMUM",
    yandexSearchApi: "25",
    yandexLive: "15",
    googleLive: "15",
    wordstat: "21"
  },
  {
    code: "PREMIUM",
    yandexSearchApi: "24",
    yandexLive: "12",
    googleLive: "12",
    wordstat: "19"
  }
];

const TURBO_SURCHARGE_PER_THOUSAND = "10";

export function xmlStockPricingMetadata(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  const input = record(value);
  const urls = record(input?.urls);
  if (input?.status !== "ok" || !urls) return undefined;
  const yandexSearchApi = toolPrice(urls.yandex);
  const yandexLive = toolPrice(urls.yandexlive);
  const googleLive = toolPrice(urls.google);
  const wordstat = toolPrice(urls.wordstat);
  if (!yandexSearchApi || !yandexLive || !googleLive || !wordstat) {
    return undefined;
  }
  const pricesPerThousand = {
    YANDEX_SEARCH_API: yandexSearchApi,
    YANDEX_LIVE: yandexLive,
    YANDEX_TURBO: addDecimals(yandexLive, TURBO_SURCHARGE_PER_THOUSAND),
    GOOGLE_LIVE: googleLive,
    WORDSTAT: wordstat
  } satisfies XmlStockPricingSummary["pricesPerThousand"];
  return {
    tariffCode: tariffCode({
      yandexSearchApi,
      yandexLive,
      googleLive,
      wordstat
    }),
    currency: "RUB",
    priceUnit: "PER_1000_REQUESTS",
    pricesPerThousand
  };
}

export function xmlStockPricingFromProviderMeta(
  providerMeta: unknown,
  observedAt?: Date | string
): XmlStockPricingSummary | undefined {
  const input = record(providerMeta);
  const pricing = record(input?.xmlStockPricing);
  const prices = record(pricing?.pricesPerThousand);
  const tariff = pricing?.tariffCode;
  if (
    !pricing ||
    !prices ||
    !["BASIC", "OPTIMAL", "MAXIMUM", "PREMIUM", "CUSTOM"].includes(
      String(tariff)
    ) ||
    pricing.currency !== "RUB" ||
    pricing.priceUnit !== "PER_1000_REQUESTS"
  ) {
    return undefined;
  }
  const parsedPrices = {
    YANDEX_SEARCH_API: decimal(prices.YANDEX_SEARCH_API),
    YANDEX_LIVE: decimal(prices.YANDEX_LIVE),
    YANDEX_TURBO: decimal(prices.YANDEX_TURBO),
    GOOGLE_LIVE: decimal(prices.GOOGLE_LIVE),
    WORDSTAT: decimal(prices.WORDSTAT)
  };
  if (Object.values(parsedPrices).some((price) => price === undefined)) {
    return undefined;
  }
  const timestamp = observedAt instanceof Date
    ? observedAt.toISOString()
    : typeof observedAt === "string" && validTimestamp(observedAt)
      ? observedAt
      : undefined;
  return {
    tariffCode: tariff as XmlStockTariffCode,
    currency: "RUB",
    priceUnit: "PER_1000_REQUESTS",
    pricesPerThousand: parsedPrices as unknown as XmlStockPricingSummary["pricesPerThousand"],
    ...(timestamp ? { observedAt: timestamp } : {})
  };
}

export function xmlStockOperationUsage(
  pricing: XmlStockPricingSummary | undefined,
  product: XmlStockOperationProduct,
  minimumRequests: number | string,
  maximumRequests: number | string,
  pricedAt?: Date | string
): XmlStockOperationUsageSummary | undefined {
  if (!pricing) return undefined;
  const minimum = count(minimumRequests);
  const maximum = count(maximumRequests);
  const pricePerThousand = decimal(pricing.pricesPerThousand[product]);
  if (
    minimum === undefined ||
    maximum === undefined ||
    BigInt(minimum) > BigInt(maximum) ||
    pricePerThousand === undefined
  ) {
    return undefined;
  }
  const unitPriceMicro = pricePerRequestMicro(pricePerThousand);
  if (unitPriceMicro === undefined) return undefined;
  const timestamp = pricedAt instanceof Date
    ? pricedAt.toISOString()
    : typeof pricedAt === "string" && validTimestamp(pricedAt)
      ? pricedAt
      : pricing.observedAt;
  if (!timestamp) return undefined;
  return {
    provider: "XMLSTOCK",
    product,
    tariffCode: pricing.tariffCode,
    currency: "RUB",
    pricePerThousand,
    unitPriceMicro,
    estimatedRequestCount: { minimum, maximum },
    estimatedCostMicro: {
      minimum: (BigInt(minimum) * BigInt(unitPriceMicro)).toString(),
      maximum: (BigInt(maximum) * BigInt(unitPriceMicro)).toString()
    },
    pricedAt: timestamp,
    priceSource: product === "YANDEX_TURBO"
      ? "XMLSTOCK_ACCOUNT_API_WITH_PUBLIC_TURBO_SURCHARGE"
      : "XMLSTOCK_ACCOUNT_API"
  };
}

export function xmlStockUsageWithActual(
  value: XmlStockOperationUsageSummary | undefined,
  minimumRequests: number | string,
  maximumRequests: number | string
): XmlStockOperationUsageSummary | undefined {
  if (!value) return undefined;
  const minimum = count(minimumRequests);
  const maximum = count(maximumRequests);
  if (
    minimum === undefined ||
    maximum === undefined ||
    BigInt(minimum) > BigInt(maximum) ||
    !COUNT_PATTERN.test(value.unitPriceMicro)
  ) {
    return undefined;
  }
  return {
    ...value,
    actualRequestCount: { minimum, maximum },
    actualCostMicro: {
      minimum: (BigInt(minimum) * BigInt(value.unitPriceMicro)).toString(),
      maximum: (BigInt(maximum) * BigInt(value.unitPriceMicro)).toString()
    }
  };
}

export function storedXmlStockOperationUsage(
  value: unknown
): XmlStockOperationUsageSummary | undefined {
  try {
    return parseXmlStockOperationUsageSummary(value);
  } catch {
    return undefined;
  }
}

function toolPrice(value: unknown): string | undefined {
  return decimal(record(value)?.price);
}

function tariffCode(input: Readonly<{
  yandexSearchApi: string;
  yandexLive: string;
  googleLive: string;
  wordstat: string;
}>): XmlStockTariffCode {
  return KNOWN_TARIFFS.find((tariff) =>
    sameDecimal(input.yandexSearchApi, tariff.yandexSearchApi) &&
    sameDecimal(input.yandexLive, tariff.yandexLive) &&
    sameDecimal(input.googleLive, tariff.googleLive) &&
    sameDecimal(input.wordstat, tariff.wordstat)
  )?.code ?? "CUSTOM";
}

function pricePerRequestMicro(pricePerThousand: string): string | undefined {
  const [whole = "0", fraction = ""] = pricePerThousand.split(".");
  const millionths = BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0"));
  if (millionths % 1_000n !== 0n) return undefined;
  return (millionths / 1_000n).toString();
}

function addDecimals(left: string, right: string): string {
  const toMillionths = (value: string): bigint => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  };
  const sum = toMillionths(left) + toMillionths(right);
  const whole = sum / 1_000_000n;
  const fraction = (sum % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sameDecimal(left: string, right: string): boolean {
  return Number(left) === Number(right);
}

function decimal(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const candidate = String(value);
  if (!DECIMAL_PATTERN.test(candidate) || !Number.isFinite(Number(candidate))) {
    return undefined;
  }
  return candidate;
}

function count(value: unknown): string | undefined {
  const candidate = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value
      : "";
  return COUNT_PATTERN.test(candidate) ? candidate : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
