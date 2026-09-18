import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAccountRegistryService } from "./platform-account-registry.service.js";

test("startup registration preserves an operator-disabled account", async () => {
  const upserts: unknown[] = [];
  const registry = new PlatformAccountRegistryService({
    platformProviderAccount: {
      upsert: async (input: unknown) => { upserts.push(input); return {}; }
    }
  } as never, {} as never, { platformProviderCredentials: {} } as never);

  await registry.register("XMLSTOCK", {
    apiKey: "key",
    accountIdentifier: "account",
    platformPool: [{
      id: "01900000-0000-7000-8000-000000000001",
      apiKey: "key",
      accountIdentifier: "account"
    }]
  });

  const update = (upserts[0] as {
    readonly update: Readonly<Record<string, unknown>>;
  }).update;
  assert.equal(Object.hasOwn(update, "enabled"), false);
  assert.equal(update.slot, 1);
  assert.ok(update.nextProbeAt instanceof Date);
});
