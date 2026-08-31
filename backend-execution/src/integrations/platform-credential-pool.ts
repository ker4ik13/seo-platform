import { createHash } from "node:crypto";
import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";

/**
 * Rendezvous hashing spreads executions evenly and keeps an asynchronous
 * provider task on the same physical key after retries, restarts and worker
 * failover. The encrypted pool is the source of truth; Redis only enforces
 * the selected physical key's request limits.
 */
export function selectIntegrationCredentialSecret(
  secret: IntegrationCredentialSecret,
  affinityId: string,
  fallbackScopeId: string
): IntegrationCredentialSecret {
  const pool = secret.platformPool;
  if (!pool || pool.length === 0) {
    return {
      apiKey: secret.apiKey,
      ...(secret.accountIdentifier
        ? { accountIdentifier: secret.accountIdentifier }
        : {}),
      rateLimitScopeId: secret.rateLimitScopeId ?? fallbackScopeId
    };
  }

  let selected = pool[0]!;
  let selectedScore = score(affinityId, selected.id);
  for (const candidate of pool.slice(1)) {
    const candidateScore = score(affinityId, candidate.id);
    if (Buffer.compare(candidateScore, selectedScore) > 0) {
      selected = candidate;
      selectedScore = candidateScore;
    }
  }
  return {
    apiKey: selected.apiKey,
    ...(selected.accountIdentifier
      ? { accountIdentifier: selected.accountIdentifier }
      : {}),
    rateLimitScopeId: selected.id
  };
}

function score(affinityId: string, poolEntryId: string): Buffer {
  return createHash("sha256")
    .update("seo-platform:platform-provider-pool-selection:v1", "utf8")
    .update("\0", "utf8")
    .update(affinityId, "utf8")
    .update("\0", "utf8")
    .update(poolEntryId, "utf8")
    .digest();
}
