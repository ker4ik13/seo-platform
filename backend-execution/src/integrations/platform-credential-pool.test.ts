import assert from "node:assert/strict";
import test from "node:test";
import { selectIntegrationCredentialSecret } from "./platform-credential-pool.js";

const firstId = "01900000-0000-8000-8000-000000000001";
const secondId = "01900000-0000-8000-8000-000000000002";
const fallbackId = "01900000-0000-7000-8000-000000000003";

test("keeps one execution on one pool entry regardless of pool order", () => {
  const entries = [
    { id: firstId, apiKey: "first-secret" },
    { id: secondId, apiKey: "second-secret" }
  ] as const;
  const affinityId = "01900000-0000-7000-8000-000000000004";
  const forward = selectIntegrationCredentialSecret(
    { apiKey: entries[0].apiKey, rateLimitScopeId: entries[0].id, platformPool: entries },
    affinityId,
    fallbackId
  );
  const reverse = selectIntegrationCredentialSecret(
    {
      apiKey: entries[1].apiKey,
      rateLimitScopeId: entries[1].id,
      platformPool: [...entries].reverse()
    },
    affinityId,
    fallbackId
  );

  assert.equal(forward.apiKey, reverse.apiKey);
  assert.equal(forward.rateLimitScopeId, reverse.rateLimitScopeId);
  assert.equal(forward.platformPool, undefined);
});

test("distributes independent executions across the key pool", () => {
  const secret = {
    apiKey: "first-secret",
    rateLimitScopeId: firstId,
    platformPool: [
      { id: firstId, apiKey: "first-secret" },
      { id: secondId, apiKey: "second-secret" }
    ]
  } as const;
  const selected = new Set(
    Array.from({ length: 100 }, (_, index) =>
      selectIntegrationCredentialSecret(
        secret,
        `01900000-0000-7000-8000-${String(index).padStart(12, "0")}`,
        fallbackId
      ).rateLimitScopeId
    )
  );

  assert.deepEqual(selected, new Set([firstId, secondId]));
});

test("uses the credential row as a legacy and BYOK rate-limit scope", () => {
  assert.deepEqual(
    selectIntegrationCredentialSecret(
      { apiKey: "legacy-secret", accountIdentifier: "account" },
      "01900000-0000-7000-8000-000000000004",
      fallbackId
    ),
    {
      apiKey: "legacy-secret",
      accountIdentifier: "account",
      rateLimitScopeId: fallbackId
    }
  );
});
