import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectConnectorCredentialOption } from "@seo-platform/contracts";
import {
  frequencyProviderUsageEstimate,
  rankProviderUsageEstimate
} from "./provider-usage-estimate.ts";

const xmlStock = {
  id: "019fc000-0000-7000-8000-000000000003",
  workspaceId: "019fc000-0000-7000-8000-000000000004",
  provider: "XMLSTOCK",
  label: "Основной XMLStock",
  mode: "BYOK_API_KEY",
  status: "ACTIVE",
  capabilities: ["WORDSTAT", "SERP_RANK_TRACKING"],
  quota: {
    status: "AVAILABLE",
    unit: "XMLSTOCK_REQUESTS",
    remaining: 420,
    balance: { amount: "27.39", currency: "RUB" },
    xmlStockPricing: {
      tariffCode: "BASIC",
      currency: "RUB",
      priceUnit: "PER_1000_REQUESTS",
      pricesPerThousand: {
        YANDEX_SEARCH_API: "28",
        YANDEX_LIVE: "25",
        YANDEX_TURBO: "35",
        GOOGLE_LIVE: "25",
        WORDSTAT: "25"
      },
      observedAt: "2026-09-15T09:00:00.000Z"
    }
  }
} as const satisfies ProjectConnectorCredentialOption;

test("estimates XMLStock Wordstat calls and shows current account capacity", () => {
  const estimate = frequencyProviderUsageEstimate(xmlStock, 12, 3);
  assert.match(estimate.usage, /^Базовый тариф · 25 ₽ за 1000 · 36 запросов · 0,90\s₽$/u);
  assert.match(estimate.available, /27,39/u);
  assert.match(estimate.available, /420 запросов/u);
});

test("estimates XMLStock Google pages by selected depth", () => {
  assert.match(
    rankProviderUsageEstimate(xmlStock, 12, "GOOGLE", 30, "LIVE").usage,
    /^Базовый тариф · 25 ₽ за 1000 · 36 запросов · 0,90\s₽$/u
  );
  assert.match(
    rankProviderUsageEstimate(
      xmlStock,
      12,
      "YANDEX",
      30,
      "SEARCH_API"
    ).usage,
    /^Базовый тариф · 28 ₽ за 1000 · 12 запросов · 0,34\s₽$/u
  );
});

test("shows the selected XMLStock competitor depth", () => {
  assert.match(
    rankProviderUsageEstimate(
      xmlStock,
      12,
      "GOOGLE",
      100,
      "LIVE",
      undefined,
      "COMPETITOR_SERP"
    ).usage,
    /^Базовый тариф · 25 ₽ за 1000 · 120 запросов · 3,00\s₽$/u
  );
  assert.match(
    rankProviderUsageEstimate(
      xmlStock,
      12,
      "YANDEX",
      100,
      "SEARCH_API",
      undefined,
      "COMPETITOR_SERP"
    ).usage,
    /^Базовый тариф · 28 ₽ за 1000 · 12 запросов · 0,34\s₽$/u
  );
});

test("shows the documented Turbo page range and higher tariff", () => {
  const estimate = rankProviderUsageEstimate(
    xmlStock,
    12,
    "YANDEX",
    100,
    "LIVE",
    "TURBO"
  );
  assert.match(
    estimate.usage,
    /^Базовый тариф · 35 ₽ за 1000 · 24–120 запросов · 0,84\s₽–4,20\s₽$/u
  );
});

test("platform credentials never expose the shared provider account quota", () => {
  const platform = {
    ...xmlStock,
    mode: "PLATFORM_PAID"
  } as const satisfies ProjectConnectorCredentialOption;
  assert.deepEqual(
    rankProviderUsageEstimate(platform, 12, "YANDEX", 30, "LIVE"),
    {
      usage: "Точная стоимость после расчёта",
      available: "Баланс данных рабочей области"
    }
  );
  assert.deepEqual(frequencyProviderUsageEstimate(platform, 12, 3), {
    usage: "Точная стоимость после расчёта",
    available: "Баланс данных рабочей области"
  });
});
