import type {
  IntegrationProvider,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";

export const integrationProviderCatalog = [
  {
    provider: "XMLSTOCK",
    displayName: "XMLStock",
    description:
      "Search results, rank tracking and Wordstat through a user-owned XMLStock account.",
    capabilities: [
      "SERP_RANK_TRACKING",
      "SERP_COLLECTION",
      "WORDSTAT"
    ],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "PROVIDER_DOCUMENTATION_REQUIRED",
    requiresAccountIdentifier: true,
    accountIdentifierLabel: "XMLStock user ID",
    subscriptionNotice:
      "Requests are charged by XMLStock under the workspace owner's own account."
  },
  {
    provider: "ARSENKIN",
    displayName: "Arsenkin Tools",
    description:
      "Clustering, indexation checks and supported SEO tools through a user-owned account.",
    capabilities: ["CLUSTERING", "INDEXATION"],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "ACCOUNT_METADATA",
    requiresAccountIdentifier: false,
    subscriptionNotice:
      "An Arsenkin Tools plan with API access is purchased separately."
  },
  {
    provider: "KEYS_SO",
    displayName: "Keys.so",
    description:
      "Keyword, competitor and SERP research through a user-owned Keys.so account.",
    capabilities: [
      "KEYWORD_RESEARCH",
      "COMPETITOR_RESEARCH",
      "SERP_COLLECTION"
    ],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "ACCOUNT_METADATA",
    requiresAccountIdentifier: false,
    subscriptionNotice:
      "A Keys.so plan with REST API access is purchased separately."
  }
] as const satisfies readonly IntegrationProviderCatalogItem[];

export function integrationProviderMetadata(
  provider: IntegrationProvider
): IntegrationProviderCatalogItem {
  const item = integrationProviderCatalog.find(
    (candidate) => candidate.provider === provider
  );
  if (!item) throw new Error(`Unsupported integration provider: ${provider}`);
  return item;
}
