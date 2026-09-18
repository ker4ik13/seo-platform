import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAccountProbeService } from "./platform-account-probe.service.js";

test("probes the XMLStock API key paired with the configured account", async () => {
  const firstId = "01900000-0000-7000-8000-000000000001";
  const secondId = "01900000-0000-7000-8000-000000000002";
  const requests: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requests.push(url);
    const body = !url.searchParams.has("info") && !url.searchParams.has("pagetype")
      ? { limits: 100, "outgo-month": 2, "outgo-day": 1, balance: "1250.50" }
      : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const writes: unknown[] = [];
  let candidateReturned = false;
  const prisma = {
    platformProviderAccount: {
      findFirst: async () => {
        if (candidateReturned) return null;
        candidateReturned = true;
        return {
          id: secondId,
          provider: "XMLSTOCK",
          enabled: true,
          nextProbeAt: new Date(0),
          leaseExpiresAt: null
        };
      },
      updateMany: async (input: unknown) => {
        writes.push(input);
        return { count: 1 };
      }
    }
  };
  const accounts = {
    configuredAccounts: () => [
      {
        id: firstId,
        provider: "XMLSTOCK",
        slot: 1,
        secret: {
          apiKey: "xmlstock-key-one",
          accountIdentifier: "account-one",
          rateLimitScopeId: firstId
        }
      },
      {
        id: secondId,
        provider: "XMLSTOCK",
        slot: 2,
        secret: {
          apiKey: "xmlstock-key-two",
          accountIdentifier: "account-two",
          rateLimitScopeId: secondId
        }
      }
    ]
  };
  const service = new PlatformAccountProbeService(
    prisma as never,
    accounts as never,
    { integrationCredentialValidation: { timeoutMs: 8_000 } } as never
  );

  try {
    assert.equal(await service.probeOne(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 4);
  for (const url of requests) {
    assert.equal(url.searchParams.get("user"), "account-two");
    assert.equal(url.searchParams.get("key"), "xmlstock-key-two");
  }
  assert.equal(writes.length, 2);
  assert.deepEqual(
    (writes[1] as { data: Record<string, unknown> }).data.remaining,
    "1250.50"
  );
  assert.equal(
    (writes[1] as { data: Record<string, unknown> }).data.errorCode,
    null
  );
});
