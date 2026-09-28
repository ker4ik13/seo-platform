import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";

export function xmlStockAuthenticatedUrl(
  endpoint: string | URL,
  secret: IntegrationCredentialSecret,
  softId?: string
): URL {
  if (!secret.accountIdentifier) {
    throw new TypeError("XMLStock account identifier is required");
  }
  const url = new URL(endpoint);
  url.searchParams.set("user", secret.accountIdentifier);
  url.searchParams.set("key", secret.apiKey);
  if (softId) url.searchParams.set("soft_id", softId);
  return url;
}
