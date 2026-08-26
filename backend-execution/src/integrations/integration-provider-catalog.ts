import type {
  IntegrationProvider,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";

export const integrationProviderCatalog = [
  {
    provider: "XMLSTOCK",
    displayName: "XMLStock",
    description:
      "Search results, rank tracking, Wordstat frequencies and keyword expansion through a user-owned XMLStock account.",
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
      "Requests are charged by XMLStock under the workspace owner's own account."
  },
  {
    provider: "ARSENKIN",
    displayName: "Arsenkin Tools",
    description:
      "Rank tracking, AI answer monitoring, Wordstat collection and expansion, and keyword clustering through a user-owned Arsenkin Tools account.",
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
      "An Arsenkin Tools plan with API access is purchased separately."
  },
  {
    provider: "KEYS_SO",
    displayName: "Keys.so",
    description:
      "Competitor keyword research with reviewed import into the project semantic core.",
    capabilities: [
      "KEYWORD_RESEARCH",
      "COMPETITOR_RESEARCH"
    ],
    supportedModes: ["BYOK_API_KEY"],
    credentialValidationMode: "ACCOUNT_METADATA",
    requiresAccountIdentifier: false,
    subscriptionNotice:
      "A Keys.so plan with REST API access is purchased separately."
  }
] as const satisfies readonly IntegrationProviderCatalogItem[];

export const operationalIntegrationProviderCatalog =
  integrationProviderCatalog.filter(
    ({ credentialValidationMode }) =>
      credentialValidationMode === "ACCOUNT_METADATA"
  );

export function integrationProviderMetadata(
  provider: IntegrationProvider
): IntegrationProviderCatalogItem {
  const item = integrationProviderCatalog.find(
    (candidate) => candidate.provider === provider
  );
  if (!item) throw new Error(`Unsupported integration provider: ${provider}`);
  return item;
}
