import type {
  ConnectorFallbackMode,
  IntegrationCapability,
  IntegrationCredentialMode,
  IntegrationProvider,
  ProjectConnectorBindingAvailability,
  ProjectConnectorRouteSourceKind
} from "../api/integrations.js";

export const projectConnectorBindingChangedFields = [
  "enabled",
  "route",
  "fallbackPolicy",
  "budgetPolicy"
] as const;

export type ProjectConnectorBindingChangedField =
  (typeof projectConnectorBindingChangedFields)[number];

export interface ProjectConnectorBindingEventRoute {
  readonly position: number;
  readonly sourceKind: ProjectConnectorRouteSourceKind;
  readonly provider: IntegrationProvider;
  readonly credentialMode: IntegrationCredentialMode;
}

/**
 * Redacted payload project connector binding events. Credential identifiers,
 * labels, hints, provider metadata and secret material are intentionally
 * excluded from this cross-service contract.
 */
export interface ProjectConnectorBindingEventDataV1 {
  readonly bindingId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly capability: IntegrationCapability;
  readonly enabled: boolean;
  readonly route: ProjectConnectorBindingEventRoute;
  readonly routes?: readonly ProjectConnectorBindingEventRoute[];
  readonly fallbackMode: ConnectorFallbackMode;
  readonly budgetMode: "DISABLED";
  readonly availability: ProjectConnectorBindingAvailability;
  readonly version: number;
  readonly changedBy: string;
  readonly changedFields: readonly ProjectConnectorBindingChangedField[];
}
