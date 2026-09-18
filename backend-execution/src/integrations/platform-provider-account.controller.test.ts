import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProviderAccountController } from "./platform-provider-account.controller.js";

test("admin provider accounts show only the currently configured pool", async () => {
  let query: unknown;
  const controller = new PlatformProviderAccountController({
    platformProviderAccount: {
      findMany: async (input: unknown) => {
        query = input;
        return [{
          id: "01900000-0000-7000-8000-000000000001",
          provider: "XMLSTOCK",
          slot: 1,
          enabled: true,
          leaseExpiresAt: null,
          remaining: null,
          checkedAt: null,
          errorCode: null
        }];
      }
    }
  } as never, {
    configuredAccountIds: () => ["01900000-0000-7000-8000-000000000001"]
  } as never, {} as never);

  const response = await controller.list({
    id: "req-provider-accounts",
    headers: {
      "x-actor-id": "01900000-0000-7000-8000-000000000002"
    }
  } as never);

  assert.deepEqual(query, {
    where: {
      id: { in: ["01900000-0000-7000-8000-000000000001"] }
    },
    orderBy: [
      { provider: "asc" },
      { slot: "asc" },
      { id: "asc" }
    ],
    take: 128
  });
  assert.deepEqual(response, {
    data: [{
      id: "01900000-0000-7000-8000-000000000001",
      provider: "XMLSTOCK",
      slot: 1,
      enabled: true,
      checking: false,
      remaining: null,
      unit: "RUB",
      checkedAt: null,
      errorCode: null
    }],
    meta: { requestId: "req-provider-accounts" }
  });
});

test("admin can disable one configured physical account", async () => {
  const accountId = "01900000-0000-7000-8000-000000000001";
  let command: unknown;
  const controller = new PlatformProviderAccountController({
    platformProviderAccount: {
      findMany: async () => [{
        id: accountId,
        provider: "ARSENKIN",
        slot: 1,
        enabled: false,
        leaseExpiresAt: null,
        remaining: "1200",
        checkedAt: new Date("2026-09-18T20:00:00.000Z"),
        errorCode: null
      }]
    }
  } as never, {
    configuredAccountIds: () => [accountId],
    setEnabled: async (id: string, enabled: boolean) => {
      command = { id, enabled };
    }
  } as never, {
    requestProbe: async () => { throw new Error("disabled accounts are not probed"); }
  } as never);

  const response = await controller.setEnabled(
    accountId,
    { enabled: false },
    {
      id: "req-provider-disable",
      headers: {
        "x-actor-id": "01900000-0000-7000-8000-000000000002"
      }
    } as never
  );

  assert.deepEqual(command, { id: accountId, enabled: false });
  assert.equal(response.data.enabled, false);
  assert.equal(response.data.checking, false);
});
