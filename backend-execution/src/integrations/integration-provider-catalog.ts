import type {
  IntegrationProvider,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";

export const integrationProviderCatalog = [
  {
    provider: "XMLSTOCK",
    displayName: "XMLStock",
    description:
      "Поисковая выдача, проверка позиций, частотности Wordstat и расширение семантики через XMLStock.",
    capabilities: [
      "SERP_RANK_TRACKING",
      "SERP_COLLECTION",
      "WORDSTAT",
      "KEYWORD_RESEARCH"
    ],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "ACCOUNT_METADATA",
    requiresAccountIdentifier: true,
    accountIdentifierLabel: "XMLStock user ID",
    subscriptionNotice:
      "При собственном ключе запросы оплачиваются по тарифу аккаунта владельца workspace."
  },
  {
    provider: "ARSENKIN",
    displayName: "Arsenkin Tools",
    description:
      "Проверка позиций, мониторинг AI-ответов, Wordstat и кластеризация через Arsenkin Tools.",
    capabilities: [
      "SERP_RANK_TRACKING",
      "SERP_COLLECTION",
      "WORDSTAT",
      "CLUSTERING",
      "KEYWORD_RESEARCH"
    ],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "ACCOUNT_METADATA",
    requiresAccountIdentifier: false,
    subscriptionNotice:
      "При собственном ключе тариф Arsenkin Tools с API оплачивается отдельно."
  },
  {
    provider: "KEYS_SO",
    displayName: "Keys.so",
    description:
      "Сбор запросов конкурентов с предпросмотром и импортом в семантическое ядро.",
    capabilities: [
      "KEYWORD_RESEARCH",
      "COMPETITOR_RESEARCH"
    ],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "ACCOUNT_METADATA",
    requiresAccountIdentifier: false,
    subscriptionNotice:
      "Тариф Keys.so с доступом к REST API оплачивается отдельно."
  }
] as const satisfies readonly IntegrationProviderCatalogItem[];

export const operationalIntegrationProviderCatalog =
  integrationProviderCatalog.filter(
    ({ credentialValidationMode }) =>
      credentialValidationMode === "ACCOUNT_METADATA"
  );

export function operationalIntegrationProviderCatalogForPlatform(
  configuredProviders: ReadonlySet<"XMLSTOCK" | "ARSENKIN">
): readonly IntegrationProviderCatalogItem[] {
  return operationalIntegrationProviderCatalog.map((item) => {
    if (
      (item.provider !== "XMLSTOCK" && item.provider !== "ARSENKIN") ||
      !configuredProviders.has(item.provider)
    ) {
      return item;
    }
    return {
      ...item,
      description:
        `${item.description} В режиме внутренних токенов ` +
        "сейчас доступна только проверка позиций.",
      supportedModes: ["BYOK_API_KEY", "PLATFORM_PAID"],
      subscriptionNotice:
        `${item.subscriptionNotice} Для системного подключения ` +
        "стоимость показывается до запуска и списывается из внутренних токенов."
    };
  });
}

export function integrationProviderMetadata(
  provider: IntegrationProvider
): IntegrationProviderCatalogItem {
  const item = integrationProviderCatalog.find(
    (candidate) => candidate.provider === provider
  );
  if (!item) throw new Error(`Unsupported integration provider: ${provider}`);
  return item;
}
