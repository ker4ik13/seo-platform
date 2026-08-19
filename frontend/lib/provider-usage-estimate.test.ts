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
    balance: { amount: "27.39", currency: "RUB" }
  }
} as const satisfies ProjectConnectorCredentialOption;

test("estimates XMLStock Wordstat calls and shows current account capacity", () => {
  const estimate = frequencyProviderUsageEstimate(xmlStock, 12, 3);
  assert.equal(estimate.usage, "до 36 запросов XMLStock");
  assert.match(estimate.available, /27,39/u);
  assert.match(estimate.available, /420 запросов/u);
});

test("estimates XMLStock Google pages by selected depth", () => {
  assert.match(
    rankProviderUsageEstimate(xmlStock, 12, "GOOGLE", 30, "LIVE").usage,
    /^до 36 запросов XMLStock · от 0,43\s₽$/u
  );
  assert.match(
    rankProviderUsageEstimate(
      xmlStock,
      12,
      "YANDEX",
      30,
      "SEARCH_API"
    ).usage,
    /^до 12 запросов XMLStock · от 0,29\s₽$/u
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
  assert.equal(
    estimate.usage,
    "24–120 запросов XMLStock Turbo · повышенный тариф"
  );
});
