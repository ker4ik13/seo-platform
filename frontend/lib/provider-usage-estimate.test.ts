import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectConnectorCredentialOption } from "@seo-platform/contracts";
import {
  frequencyRouteSource,
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

test("selects the first workspace fallback that can fund the complete frequency run", () => {
  const lowBalance = {
    ...xmlStock,
    id: "019fc000-0000-7000-8000-000000000010",
    quota: {
      ...xmlStock.quota,
      balance: { amount: "1", currency: "RUB" as const }
    }
  } satisfies ProjectConnectorCredentialOption;
  const funded = {
    ...xmlStock,
    id: "019fc000-0000-7000-8000-000000000011",
    label: "Резервный XMLStock",
    quota: {
      ...xmlStock.quota,
      balance: { amount: "4150.99", currency: "RUB" as const },
      xmlStockPricing: {
        ...xmlStock.quota.xmlStockPricing,
        tariffCode: "OPTIMAL" as const,
        pricesPerThousand: {
          YANDEX_SEARCH_API: "27",
          YANDEX_LIVE: "20",
          YANDEX_TURBO: "30",
          GOOGLE_LIVE: "20",
          WORDSTAT: "23"
        }
      }
    }
  } satisfies ProjectConnectorCredentialOption;

  assert.equal(
    frequencyRouteSource([lowBalance, funded], 3_642, 3, true)?.id,
    funded.id
  );
  assert.equal(
    frequencyRouteSource([lowBalance, funded], 3_642, 3, false)?.id,
    lowBalance.id
  );
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

test("shows the bounded Turbo Top-100 request count and higher tariff", () => {
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
    /^Базовый тариф · 35 ₽ за 1000 · от 24 до 120 запросов · от 0,84\s₽ до 4,20\s₽$/u
  );
});

test("shows a bounded XMLStock request and price range when stopping after the first position", () => {
  const estimate = rankProviderUsageEstimate(
    xmlStock,
    12,
    "YANDEX",
    100,
    "LIVE",
    "TURBO",
    "POSITION_TRACKING",
    "ru-RU",
    "STOP_AFTER_FOUND"
  );
  assert.match(
    estimate.usage,
    /^Базовый тариф · 35 ₽ за 1000 · от 12 до 120 запросов · от 0,42\s₽ до 4,20\s₽$/u
  );
});

test("renders provider tariff, request range, balance and cost in English", () => {
  const estimate = rankProviderUsageEstimate(
    xmlStock,
    12,
    "YANDEX",
    100,
    "LIVE",
    "TURBO",
    "POSITION_TRACKING",
    "en-US",
    "STOP_AFTER_FOUND"
  );
  assert.match(estimate.tariff ?? "", /^Basic plan · RUB/u);
  assert.equal(estimate.requestRange, "from 12 to 120 requests");
  assert.match(estimate.available, /requests/u);
  assert.match(estimate.costRange ?? "", /^from RUB/u);
  assert.doesNotMatch(JSON.stringify(estimate), /[А-Яа-яЁё]/u);
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
      available: "Баланс данных рабочей области",
      tariff: "Платформа",
      costRange: "Точная стоимость после расчёта"
    }
  );
  assert.deepEqual(frequencyProviderUsageEstimate(platform, 12, 3), {
    usage: "Точная стоимость после расчёта",
    available: "Баланс данных рабочей области",
    tariff: "Платформа",
    costRange: "Точная стоимость после расчёта"
  });
});
