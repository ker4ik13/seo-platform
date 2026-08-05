import type {
  IntegrationCapability,
  IntegrationProvider
} from "@seo-platform/contracts";
import { integrationProviderMetadata } from "./integration-provider-catalog.js";

/**
 * Stored provider data is never allowed to grant a capability that the
 * current connector catalog does not expose. Invalid legacy JSON fails
 * closed to an empty capability set.
 */
export function safeIntegrationCredentialCapabilities(
  provider: IntegrationProvider,
  stored: unknown
): readonly IntegrationCapability[] {
  if (!Array.isArray(stored)) return [];
  const persisted = new Set(
    stored.filter((value): value is string => typeof value === "string")
  );
  return integrationProviderMetadata(provider).capabilities.filter(
    (capability) => persisted.has(capability)
  );
}
