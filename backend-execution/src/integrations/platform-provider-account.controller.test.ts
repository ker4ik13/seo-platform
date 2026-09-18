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
          remaining: null,
          checkedAt: null,
          errorCode: null
        }];
      }
    }
  } as never);

  const response = await controller.list({
    id: "req-provider-accounts",
    headers: {
      "x-actor-id": "01900000-0000-7000-8000-000000000002"
    }
  } as never);

  assert.deepEqual(query, {
    where: { enabled: true },
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
      remaining: null,
      unit: "RUB",
      checkedAt: null,
      errorCode: null
    }],
    meta: { requestId: "req-provider-accounts" }
  });
});
