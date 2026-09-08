/** Integer-only pricing. One rouble = 1,000,000 micro; one kopek = 10,000 micro. */
export interface ProviderPricingPolicy {
  readonly targetMarginBps: number;
  readonly paymentFeeBps: number;
  readonly taxReserveBps: number;
  readonly contingencyBps: number;
}
export const defaultProviderPricingPolicy: ProviderPricingPolicy = {
  targetMarginBps: 5_000, paymentFeeBps: 450, taxReserveBps: 600, contingencyBps: 250
};
const MAX_MONEY_MINOR = 100_000_000n;

export function customerChargeMinor(providerCostMicro: bigint, policy: ProviderPricingPolicy = defaultProviderPricingPolicy): bigint {
  if (providerCostMicro < 0n) throw new RangeError("Provider cost cannot be negative");
  for (const value of Object.values(policy)) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 10_000) throw new RangeError("Invalid pricing rate");
  }
  const denominator = 10_000 - policy.targetMarginBps - policy.paymentFeeBps - policy.taxReserveBps - policy.contingencyBps;
  if (denominator <= 0) throw new RangeError("Pricing policy leaves no room for provider cost");
  // costMicro * 10000 / denominator / microPerKopek; the 10000 factors cancel.
  const amount = ceilDiv(providerCostMicro, BigInt(denominator));
  if (amount > MAX_MONEY_MINOR) throw new RangeError("Operation price exceeds the supported money range");
  return amount;
}
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("Invalid positive division");
  return (numerator + denominator - 1n) / denominator;
}

export type ProviderProduct = "XMLSTOCK_GOOGLE_LIVE" | "XMLSTOCK_YANDEX_LIVE" | "XMLSTOCK_YANDEX_TURBO" | "XMLSTOCK_YANDEX_SEARCH_API" | "XMLSTOCK_WORDSTAT" | "ARSENKIN_LIMIT";
export const providerCostBook = {
  version: "2026-09-06@2",
  // XMLStock base PAYG price, without assuming a prepaid volume discount.
  unitCostMicro: {
    XMLSTOCK_GOOGLE_LIVE: 25_000n,
    XMLSTOCK_YANDEX_LIVE: 25_000n,
    XMLSTOCK_YANDEX_TURBO: 35_000n,
    XMLSTOCK_YANDEX_SEARCH_API: 28_000n,
    XMLSTOCK_WORDSTAT: 25_000n,
    // Standard (API-enabled): ceil(2490 RUB / 85000 limits), not a legacy tariff.
    ARSENKIN_LIMIT: 29_295n
  } satisfies Readonly<Record<ProviderProduct, bigint>>
};

export interface OperationWorkload {
  readonly provider: "XMLSTOCK" | "ARSENKIN";
  readonly operation: "POSITIONS" | "COMPETITOR_SERP" | "FREQUENCY" | "WORDSTAT_EXPANSION" | "AI_ANSWER" | "CLUSTERING";
  readonly keywordCount: number;
  readonly depth?: number;
  readonly searchSource?: "GOOGLE_LIVE" | "YANDEX_LIVE" | "YANDEX_TURBO" | "YANDEX_SEARCH_API";
  readonly frequencyVariantCount?: number;
}
export function priceOperation(workload: OperationWorkload, policy: ProviderPricingPolicy = defaultProviderPricingPolicy, costBook = providerCostBook.unitCostMicro): {
  product: ProviderProduct; providerUnitsMilli: string; providerCostMicro: string; customerChargeMinor: number; customerChargeMicro: string; priceBookVersion: string;
} {
  const count = workload.keywordCount;
  if (!Number.isSafeInteger(count) || count < 1 || count > 300_000) throw new RangeError("Invalid keyword count");
  const frequency = workload.frequencyVariantCount ?? 1;
  if (!Number.isSafeInteger(frequency) || frequency < 0 || frequency > (workload.operation === "CLUSTERING" ? 4 : 3)) throw new RangeError("Invalid frequency variant count");
  let product: ProviderProduct;
  let multiplierMilli: number;
  if (workload.provider === "ARSENKIN") {
    product = "ARSENKIN_LIMIT";
    switch (workload.operation) {
      case "POSITIONS": {
        const depth = workload.depth ?? 30;
        if (![30, 50, 100].includes(depth)) throw new RangeError("Invalid Arsenkin SERP depth");
        multiplierMilli = workload.searchSource === "GOOGLE_LIVE" ? (depth === 100 ? 5_000 : depth === 50 ? 3_000 : 2_000) : 2_000;
        break;
      }
      case "COMPETITOR_SERP": multiplierMilli = 1_000; break;
      case "FREQUENCY": if (!frequency) throw new RangeError("Frequency variants are required"); multiplierMilli = frequency * 1_000; break;
      case "WORDSTAT_EXPANSION": case "AI_ANSWER": multiplierMilli = 2_000; break;
      case "CLUSTERING": multiplierMilli = 1_500 + (workload.frequencyVariantCount ?? 0) * 1_000; break;
      default: throw new RangeError("Unsupported provider operation");
    }
  } else if (workload.provider === "XMLSTOCK") {
    if (["FREQUENCY", "WORDSTAT_EXPANSION"].includes(workload.operation)) {
      if (workload.operation === "FREQUENCY" && !frequency) throw new RangeError("Frequency variants are required");
      product = "XMLSTOCK_WORDSTAT";
      multiplierMilli = (workload.operation === "FREQUENCY" ? frequency : 1) * 1_000;
    } else if (["POSITIONS", "COMPETITOR_SERP"].includes(workload.operation)) {
      const depth = workload.operation === "COMPETITOR_SERP" ? 10 : workload.depth ?? 100;
      if (!Number.isSafeInteger(depth) || depth < 10 || depth > 100 || depth % 10) throw new RangeError("Invalid SERP depth");
      const source = workload.searchSource ?? "YANDEX_LIVE";
      const products = { GOOGLE_LIVE: "XMLSTOCK_GOOGLE_LIVE", YANDEX_LIVE: "XMLSTOCK_YANDEX_LIVE", YANDEX_TURBO: "XMLSTOCK_YANDEX_TURBO", YANDEX_SEARCH_API: "XMLSTOCK_YANDEX_SEARCH_API" } as const;
      product = products[source];
      if (!product) throw new RangeError("Invalid search source");
      // Turbo may return 10..50 rows/page; reserve conservatively for 10 and
      // settle actual pages. Ordinary Live Top-100 is ten paid pages.
      multiplierMilli = (source === "YANDEX_SEARCH_API" ? 1 : depth / 10) * 1_000;
    } else throw new RangeError("Unsupported XMLStock operation");
  } else throw new RangeError("Unsupported provider");
  const units = BigInt(count) * BigInt(multiplierMilli);
  const cost = ceilDiv(costBook[product] * units, 1_000n);
  const charge = customerChargeMinor(cost, policy);
  return { product, providerUnitsMilli: units.toString(), providerCostMicro: cost.toString(), customerChargeMinor: Number(charge), customerChargeMicro: (charge * 10_000n).toString(), priceBookVersion: providerCostBook.version };
}
