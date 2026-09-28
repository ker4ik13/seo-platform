import {
  integrationCapabilities,
  type IntegrationProvider,
  type IntegrationCapability
} from "@seo-platform/contracts";

/** Temporary catalog policy; saved Keys.so credentials and history stay intact. */
export function isVisibleIntegrationProvider(provider: IntegrationProvider): boolean {
  return provider !== "KEYS_SO";
}

export const visibleRoutingCapabilities: readonly IntegrationCapability[] =
  integrationCapabilities.filter((capability) => capability !== "COMPETITOR_RESEARCH");
