export const integrationProviders = [
  "XMLSTOCK",
  "ARSENKIN",
  "KEYS_SO"
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export const integrationCapabilities = [
  "SERP_RANK_TRACKING",
  "SERP_COLLECTION",
  "WORDSTAT",
  "CLUSTERING",
  "INDEXATION",
  "KEYWORD_RESEARCH",
  "COMPETITOR_RESEARCH"
] as const;

export type IntegrationCapability =
  (typeof integrationCapabilities)[number];

export const integrationCredentialModes = [
  "BYOK_API_KEY",
  "BYOK_OAUTH",
  "PLATFORM_INCLUDED",
  "PLATFORM_PAID",
  "FALLBACK_PLATFORM_PAID"
] as const;

export type IntegrationCredentialMode =
  (typeof integrationCredentialModes)[number];

export const integrationCredentialStatuses = [
  "PENDING_VERIFICATION",
  "ACTIVE",
  "DEGRADED",
  "RATE_LIMITED",
  "LOW_BALANCE",
  "EXPIRED",
  "REVOKED",
  "INVALID",
  "DISABLED"
] as const;

export type IntegrationCredentialStatus =
  (typeof integrationCredentialStatuses)[number];

export interface IntegrationProviderCatalogItem {
  readonly provider: IntegrationProvider;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: readonly IntegrationCapability[];
  readonly supportedModes: readonly IntegrationCredentialMode[];
  readonly requiresAccountIdentifier: boolean;
  readonly accountIdentifierLabel?: string;
  readonly subscriptionNotice: string;
}

export interface IntegrationCredentialSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: IntegrationProvider;
  readonly label: string;
  readonly mode: IntegrationCredentialMode;
  readonly status: IntegrationCredentialStatus;
  readonly displayHint: string;
  readonly capabilities: readonly IntegrationCapability[];
  readonly verifiedAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastErrorAt?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateIntegrationCredentialInput {
  readonly provider: IntegrationProvider;
  readonly label: string;
  readonly apiKey: string;
  readonly accountIdentifier?: string;
}

export interface InternalCreateIntegrationCredentialInput
  extends CreateIntegrationCredentialInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface UpdateIntegrationCredentialInput {
  readonly label: string;
  readonly apiKey?: string;
  readonly accountIdentifier?: string;
}

export interface InternalUpdateIntegrationCredentialInput
  extends UpdateIntegrationCredentialInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteIntegrationCredentialInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly version: number;
}
