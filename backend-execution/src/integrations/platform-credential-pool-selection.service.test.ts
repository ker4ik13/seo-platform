import assert from "node:assert/strict";
import test from "node:test";
import { PlatformCredentialPoolSelectionService, PlatformProviderAccountUnavailableError } from "./platform-credential-pool-selection.service.js";
import { selectIntegrationCredentialSecret } from "./platform-credential-pool.js";

const entries = [
  { id: "01900000-0000-7000-8000-000000000001", apiKey: "key-one", accountIdentifier: "account-one" },
  { id: "01900000-0000-7000-8000-000000000002", apiKey: "key-two", accountIdentifier: "account-two" }
] as const;
const secret = {
  apiKey: entries[0].apiKey,
  accountIdentifier: entries[0].accountIdentifier,
  rateLimitScopeId: entries[0].id,
  platformPool: entries
} as const;

test("new platform work skips a disabled physical account", async () => {
  const affinity = "01900000-0000-7000-8000-000000000010";
  const original = selectIntegrationCredentialSecret(secret, affinity, "fallback");
  const enabledId = entries.find(({ id }) => id !== original.rateLimitScopeId)!.id;
  const service = new PlatformCredentialPoolSelectionService({
    $queryRaw: async () => [{ id: enabledId }]
  } as never);

  const selected = await service.select(
    "XMLSTOCK",
    secret,
    affinity,
    "fallback"
  );

  assert.equal(selected.rateLimitScopeId, enabledId);
  assert.equal(
    selected.accountIdentifier,
    entries.find(({ id }) => id === enabledId)?.accountIdentifier
  );
});

test("an active provider task may finish on its now-disabled account", async () => {
  let reads = 0;
  const affinity = "01900000-0000-7000-8000-000000000011";
  const service = new PlatformCredentialPoolSelectionService({
    $queryRaw: async () => { reads += 1; return []; }
  } as never);
  const selected = await service.select(
    "ARSENKIN",
    secret,
    affinity,
    "fallback",
    true
  );
  assert.equal(
    selected.rateLimitScopeId,
    selectIntegrationCredentialSecret(secret, affinity, "fallback").rateLimitScopeId
  );
  assert.equal(reads, 0);
});

test("new work fails closed when every physical account is disabled", async () => {
  const service = new PlatformCredentialPoolSelectionService({
    $queryRaw: async () => []
  } as never);
  await assert.rejects(
    () => service.select(
      "XMLSTOCK",
      secret,
      "01900000-0000-7000-8000-000000000012",
      "fallback"
    ),
    PlatformProviderAccountUnavailableError
  );
});
