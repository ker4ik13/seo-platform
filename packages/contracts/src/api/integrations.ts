export const integrationProviders = [
  "XMLSTOCK",
  "ARSENKIN",
  "KEYS_SO"
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export const xmlStockTariffCodes = [
  "BASIC",
  "OPTIMAL",
  "MAXIMUM",
  "PREMIUM",
  "CUSTOM"
] as const;

export type XmlStockTariffCode = (typeof xmlStockTariffCodes)[number];

export const xmlStockOperationProducts = [
  "YANDEX_SEARCH_API",
  "YANDEX_LIVE",
  "YANDEX_TURBO",
  "GOOGLE_LIVE",
  "WORDSTAT"
] as const;

export type XmlStockOperationProduct =
  (typeof xmlStockOperationProducts)[number];

/** Safe projection of the account-specific rates returned by `info=user`. */
export interface XmlStockPricingSummary {
  readonly tariffCode: XmlStockTariffCode;
  readonly currency: "RUB";
  readonly priceUnit: "PER_1000_REQUESTS";
  readonly pricesPerThousand: Readonly<
    Record<XmlStockOperationProduct, string>
  >;
  readonly observedAt?: string;
}

/**
 * Immutable provider-cost snapshot attached to an operation. Micro values are
 * RUB × 1,000,000 and ranges remain explicit for Turbo and retry ambiguity.
 */
export interface XmlStockOperationUsageSummary {
  readonly provider: "XMLSTOCK";
  readonly product: XmlStockOperationProduct;
  readonly tariffCode: XmlStockTariffCode;
  readonly currency: "RUB";
  readonly pricePerThousand: string;
  readonly unitPriceMicro: string;
  readonly estimatedRequestCount: {
    readonly minimum: string;
    readonly maximum: string;
  };
  readonly estimatedCostMicro: {
    readonly minimum: string;
    readonly maximum: string;
  };
  readonly actualRequestCount?: {
    readonly minimum: string;
    readonly maximum: string;
  };
  readonly actualCostMicro?: {
    readonly minimum: string;
    readonly maximum: string;
  };
  readonly pricedAt: string;
  readonly priceSource:
    | "XMLSTOCK_ACCOUNT_API"
    | "XMLSTOCK_ACCOUNT_API_WITH_PUBLIC_TURBO_SURCHARGE";
}

export function parseXmlStockOperationUsageSummary(
  value: unknown
): XmlStockOperationUsageSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid XMLStock operation usage summary");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const required = [
    "provider",
    "product",
    "tariffCode",
    "currency",
    "pricePerThousand",
    "unitPriceMicro",
    "estimatedRequestCount",
    "estimatedCostMicro",
    "pricedAt",
    "priceSource"
  ];
  const optional = ["actualRequestCount", "actualCostMicro"];
  if (
    required.some((key) => !(key in input)) ||
    Object.keys(input).some(
      (key) => !required.includes(key) && !optional.includes(key)
    ) ||
    input.provider !== "XMLSTOCK" ||
    !xmlStockOperationProducts.includes(input.product as XmlStockOperationProduct) ||
    !xmlStockTariffCodes.includes(input.tariffCode as XmlStockTariffCode) ||
    input.currency !== "RUB" ||
    typeof input.pricePerThousand !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u.test(input.pricePerThousand) ||
    typeof input.unitPriceMicro !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(input.unitPriceMicro) ||
    typeof input.pricedAt !== "string" ||
    Number.isNaN(Date.parse(input.pricedAt)) ||
    new Date(input.pricedAt).toISOString() !== input.pricedAt ||
    input.priceSource !== "XMLSTOCK_ACCOUNT_API" &&
      input.priceSource !== "XMLSTOCK_ACCOUNT_API_WITH_PUBLIC_TURBO_SURCHARGE" ||
    (input.actualRequestCount === undefined) !==
      (input.actualCostMicro === undefined)
  ) {
    throw new TypeError("Invalid XMLStock operation usage summary");
  }
  const estimatedRequestCount = xmlStockUsageRange(input.estimatedRequestCount);
  const estimatedCostMicro = xmlStockUsageRange(input.estimatedCostMicro);
  const actualRequestCount = input.actualRequestCount === undefined
    ? undefined
    : xmlStockUsageRange(input.actualRequestCount);
  const actualCostMicro = input.actualCostMicro === undefined
    ? undefined
    : xmlStockUsageRange(input.actualCostMicro);
  const unit = BigInt(input.unitPriceMicro);
  if (
    BigInt(estimatedRequestCount.minimum) * unit !==
      BigInt(estimatedCostMicro.minimum) ||
    BigInt(estimatedRequestCount.maximum) * unit !==
      BigInt(estimatedCostMicro.maximum) ||
    (actualRequestCount !== undefined && actualCostMicro !== undefined &&
      (BigInt(actualRequestCount.minimum) * unit !==
        BigInt(actualCostMicro.minimum) ||
        BigInt(actualRequestCount.maximum) * unit !==
          BigInt(actualCostMicro.maximum)))
  ) {
    throw new TypeError("Invalid XMLStock operation usage summary");
  }
  return {
    provider: "XMLSTOCK",
    product: input.product as XmlStockOperationProduct,
    tariffCode: input.tariffCode as XmlStockTariffCode,
    currency: "RUB",
    pricePerThousand: input.pricePerThousand,
    unitPriceMicro: input.unitPriceMicro,
    estimatedRequestCount,
    estimatedCostMicro,
    ...(actualRequestCount && actualCostMicro
      ? { actualRequestCount, actualCostMicro }
      : {}),
    pricedAt: input.pricedAt,
    priceSource: input.priceSource as XmlStockOperationUsageSummary["priceSource"]
  };
}

function xmlStockUsageRange(value: unknown): {
  readonly minimum: string;
  readonly maximum: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid XMLStock usage range");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== 2 ||
    typeof input.minimum !== "string" ||
    typeof input.maximum !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(input.minimum) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(input.maximum) ||
    BigInt(input.minimum) > BigInt(input.maximum)
  ) {
    throw new TypeError("Invalid XMLStock usage range");
  }
  return { minimum: input.minimum, maximum: input.maximum };
}

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

/** Shared compatibility rule for catalog/route projections, not an execution grant. */
export function credentialModeSupportsCapability(mode: string, capability: IntegrationCapability, provider: string): boolean {
  return mode === "BYOK_API_KEY" || mode === "PLATFORM_PAID" && (provider === "XMLSTOCK" || provider === "ARSENKIN") && ["SERP_RANK_TRACKING", "WORDSTAT", "SERP_COLLECTION", "CLUSTERING", "KEYWORD_RESEARCH"].includes(capability);
}

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

export const integrationCredentialValidationModes = [
  "ACCOUNT_METADATA",
  "PROVIDER_DOCUMENTATION_REQUIRED"
] as const;

export type IntegrationCredentialValidationMode =
  (typeof integrationCredentialValidationModes)[number];

export const integrationCredentialValidationStatuses = [
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "STALE"
] as const;

export type IntegrationCredentialValidationStatus =
  (typeof integrationCredentialValidationStatuses)[number];

export type IntegrationCredentialQuotaSummary =
  | {
      readonly status: "NOT_AVAILABLE";
    }
  | {
      readonly status: "AVAILABLE";
      readonly unit:
        | "ARSENKIN_LIMITS"
        | "API_REQUESTS"
        | "XMLSTOCK_REQUESTS";
      readonly limit?: number;
      readonly used?: number;
      readonly remaining: number;
      /** Provider account balance. XMLStock reports monetary values in RUB. */
      readonly balance?: {
        readonly amount: string;
        readonly frozenAmount?: string;
        readonly currency: "RUB";
      };
      readonly usedToday?: number;
      readonly usedMonth?: number;
      readonly frozenRemaining?: number;
      readonly tariffDaysRemaining?: number;
      /** Current account-specific XMLStock rates; absent for other providers. */
      readonly xmlStockPricing?: XmlStockPricingSummary;
      readonly observedAt?: string;
    };

export const projectConnectorRouteSourceKinds = [
  "WORKSPACE_CREDENTIAL"
] as const;

export type ProjectConnectorRouteSourceKind =
  (typeof projectConnectorRouteSourceKinds)[number];

export const connectorFallbackModes = [
  "NONE",
  "NEXT_AVAILABLE",
  "NEXT_AVAILABLE_THEN_WORKSPACE"
] as const;

export type ConnectorFallbackMode =
  (typeof connectorFallbackModes)[number];

export const connectorFallbackReasons = [
  "CREDENTIAL_UNAVAILABLE",
  "LOW_BALANCE",
  "RATE_LIMITED",
  "RETRYABLE_PROVIDER_ERROR"
] as const;

export type ConnectorFallbackReason =
  (typeof connectorFallbackReasons)[number];

export const connectorRoutingScopes = [
  "WORKSPACE_DEFAULT",
  "PROJECT_OVERRIDE",
  "WORKSPACE_FALLBACK"
] as const;

export type ConnectorRoutingScope =
  (typeof connectorRoutingScopes)[number];

export const projectConnectorBindingAvailabilities = [
  "READY",
  "DISABLED",
  "CREDENTIAL_PENDING",
  "CREDENTIAL_UNAVAILABLE",
  "CAPABILITY_MISMATCH"
] as const;

export type ProjectConnectorBindingAvailability =
  (typeof projectConnectorBindingAvailabilities)[number];

export interface ProjectConnectorFallbackPolicy {
  readonly mode: ConnectorFallbackMode;
  /**
   * Reasons which are allowed to advance to the next route. Older clients
   * omit the field when fallback is disabled, therefore it stays optional on
   * the wire and is normalised to an empty array by services.
   */
  readonly reasons?: readonly ConnectorFallbackReason[];
}

export interface ProjectConnectorBudgetPolicy {
  readonly mode: "DISABLED";
}

export interface ProjectConnectorRouteInput {
  readonly position: number;
  readonly sourceKind: ProjectConnectorRouteSourceKind;
  readonly credentialId: string;
}

export interface ProjectConnectorRoute {
  readonly id: string;
  readonly bindingId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly position: number;
  readonly sourceKind: ProjectConnectorRouteSourceKind;
  readonly credentialId: string;
  readonly provider: IntegrationProvider;
  readonly credentialMode: IntegrationCredentialMode;
  readonly routingScope?: ConnectorRoutingScope;
  readonly workspaceRouteId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectConnectorBinding {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly capability: IntegrationCapability;
  readonly enabled: boolean;
  readonly configurationScope?: "PROJECT_OVERRIDE" | "WORKSPACE_INHERITED";
  readonly workspaceBindingId?: string;
  /**
   * Primary route retained for backward-compatible consumers. It is absent
   * only for a disabled binding whose routes were revoked by project transfer.
   */
  readonly route?: ProjectConnectorRoute;
  readonly routes?: readonly ProjectConnectorRoute[];
  readonly fallbackPolicy: ProjectConnectorFallbackPolicy;
  readonly budgetPolicy: ProjectConnectorBudgetPolicy;
  readonly availability: ProjectConnectorBindingAvailability;
  readonly version: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Безопасная для UI проекция workspace credential. Она намеренно не
 * содержит display hint, provider metadata или какие-либо secret fields.
 */
export interface ProjectConnectorCredentialOption {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: IntegrationProvider;
  readonly label: string;
  readonly mode: IntegrationCredentialMode;
  readonly status: IntegrationCredentialStatus;
  /**
   * Пересечение сохранённых capabilities с текущим provider catalog.
   */
  readonly capabilities: readonly IntegrationCapability[];
  /**
   * Безопасная квота из последней проверки подключения. Сырые provider
   * metadata и credential material в настройки маршрута не попадают.
   */
  readonly quota?: IntegrationCredentialQuotaSummary;
}

export interface ProjectConnectorBindingsAggregate {
  readonly bindings: readonly ProjectConnectorBinding[];
  readonly credentialOptions: readonly ProjectConnectorCredentialOption[];
  /**
   * True when the bounded settings aggregate has more workspace credentials.
   * Existing binding credentials are always retained in credentialOptions.
   */
  readonly credentialOptionsTruncated: boolean;
}

export const projectConnectorSettingsMutationRestrictions = [
  "NONE",
  "MISSING_PERMISSION",
  "WORKSPACE_READ_ONLY",
  "PROJECT_ARCHIVED"
] as const;

export type ProjectConnectorSettingsMutationRestriction =
  (typeof projectConnectorSettingsMutationRestrictions)[number];

export interface ProjectConnectorSettingsAccess {
  readonly canUpdateBindings: boolean;
  readonly canUseSystemCredentials: boolean;
  readonly canManageFallback: boolean;
  readonly canSetBudgets: boolean;
  readonly mutationRestriction: ProjectConnectorSettingsMutationRestriction;
}

export interface ProjectConnectorSettings
  extends ProjectConnectorBindingsAggregate {
  readonly access: ProjectConnectorSettingsAccess;
}

export interface CreateProjectConnectorBindingInput {
  readonly capability: IntegrationCapability;
  readonly enabled: boolean;
  readonly route: ProjectConnectorRouteInput;
  readonly fallbackRoutes?: readonly ProjectConnectorRouteInput[];
  readonly fallbackPolicy: ProjectConnectorFallbackPolicy;
  readonly budgetPolicy: ProjectConnectorBudgetPolicy;
}

export interface InternalCreateProjectConnectorBindingInput
  extends CreateProjectConnectorBindingInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface UpdateProjectConnectorBindingInput {
  readonly enabled: boolean;
  readonly route: ProjectConnectorRouteInput;
  readonly fallbackRoutes?: readonly ProjectConnectorRouteInput[];
  readonly fallbackPolicy: ProjectConnectorFallbackPolicy;
  readonly budgetPolicy: ProjectConnectorBudgetPolicy;
}

export interface WorkspaceConnectorRoute {
  readonly id: string;
  readonly bindingId: string;
  readonly workspaceId: string;
  readonly position: number;
  readonly credentialId: string;
  readonly provider: IntegrationProvider;
  readonly credentialMode: IntegrationCredentialMode;
  readonly availability: ProjectConnectorBindingAvailability;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceConnectorBinding {
  readonly id: string;
  readonly workspaceId: string;
  readonly capability: IntegrationCapability;
  readonly enabled: boolean;
  readonly routes: readonly WorkspaceConnectorRoute[];
  readonly fallbackPolicy: ProjectConnectorFallbackPolicy;
  readonly version: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceConnectorRoutingSettings {
  readonly bindings: readonly WorkspaceConnectorBinding[];
  readonly credentialOptions: readonly ProjectConnectorCredentialOption[];
  readonly credentialOptionsTruncated: boolean;
  readonly access: {
    readonly canUpdateBindings: boolean;
    readonly canManageFallback: boolean;
  };
}

export interface UpsertWorkspaceConnectorBindingInput {
  readonly enabled: boolean;
  readonly routes: readonly ProjectConnectorRouteInput[];
  readonly fallbackPolicy: ProjectConnectorFallbackPolicy;
  readonly version?: number;
}

export interface InternalUpsertWorkspaceConnectorBindingInput
  extends UpsertWorkspaceConnectorBindingInput {
  readonly workspaceId: string;
  readonly capability: IntegrationCapability;
  readonly actorId: string;
}

export interface EffectiveConnectorRoute {
  readonly capability: IntegrationCapability;
  readonly provider: IntegrationProvider;
  readonly credentialMode: IntegrationCredentialMode;
  readonly routingScope: ConnectorRoutingScope;
  readonly position: number;
}

export interface ConnectorOperationAttemptSummary {
  readonly sequence: number;
  readonly provider: IntegrationProvider;
  readonly routingScope: ConnectorRoutingScope;
  readonly outcome: "SELECTED" | "SUCCEEDED" | "FALLBACK" | "FAILED";
  readonly reasonCode?: string;
  readonly occurredAt: string;
}

export interface InternalUpdateProjectConnectorBindingInput
  extends UpdateProjectConnectorBindingInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalInheritProjectConnectorBindingInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface IntegrationProviderCatalogItem {
  readonly provider: IntegrationProvider;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: readonly IntegrationCapability[];
  readonly supportedModes: readonly IntegrationCredentialMode[];
  readonly credentialValidationMode: IntegrationCredentialValidationMode;
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
  /**
   * Безопасная нормализованная квота из последней проверки подключения.
   * Сырой provider metadata и секретный материал наружу не передаются.
   */
  readonly quota: IntegrationCredentialQuotaSummary;
  readonly verifiedAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastErrorAt?: string;
  readonly lastErrorCode?: string;
  /**
   * Незавершённая проверка только текущей версии секретного материала.
   * Partial unique constraint ограничивает значение одной job.
   */
  readonly activeValidation?: IntegrationCredentialValidationSummary;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationCredentialValidationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly provider: IntegrationProvider;
  readonly status: IntegrationCredentialValidationStatus;
  readonly errorCode?: string;
  readonly connectorVersion: string;
  readonly requestedAt: string;
  readonly startedAt?: string;
  readonly retryAt?: string;
  readonly finishedAt?: string;
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

export interface EnablePlatformIntegrationCredentialInput {
  readonly provider: "XMLSTOCK" | "ARSENKIN";
}

export interface InternalEnablePlatformIntegrationCredentialInput
  extends EnablePlatformIntegrationCredentialInput {
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

export interface InternalCreateIntegrationCredentialValidationInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}
