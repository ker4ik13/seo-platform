import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAccountProbeService } from "./platform-account-probe.service.js";

test("probes the XMLStock API key paired with the claimed account ID", async () => {
  const firstId = "01900000-0000-7000-8000-000000000001";
  const secondId = "01900000-0000-7000-8000-000000000002";
  const token = "01900000-0000-7000-8000-000000000003";
  const workspaceId = "01900000-0000-7000-8000-000000000004";
  const credentialId = "01900000-0000-7000-8000-000000000005";
  const claim = {
    id: secondId,
    provider: "XMLSTOCK",
    token,
    workspaceId,
    credentialId,
    ciphertext: Buffer.from("ciphertext").toString("base64"),
    nonce: Buffer.from("nonce").toString("base64"),
    authTag: Buffer.from("auth-tag").toString("base64"),
    encryptedDataKey: Buffer.from("data-key").toString("base64"),
    dataKeyNonce: Buffer.from("data-key-nonce").toString("base64"),
    dataKeyAuthTag: Buffer.from("data-key-tag").toString("base64"),
    keyVersion: 1
  } as const;
  const calls: Array<readonly unknown[]> = [];
  let claimed = false;
  const prisma = {
    $queryRaw: async (
      strings: TemplateStringsArray,
      ...values: readonly unknown[]
    ) => {
      calls.push(values);
      if (strings.join("").includes("claim_platform_provider_account_probe")) {
        if (claimed) return [{ claim: null }];
        claimed = true;
        return [{ claim }];
      }
      return [{ finished: true }];
    }
  };
  const crypto = {
    decrypt: () => ({
      apiKey: "xmlstock-key-one",
      accountIdentifier: "account-one",
      rateLimitScopeId: firstId,
      platformPool: [
        {
          id: firstId,
          apiKey: "xmlstock-key-one",
          accountIdentifier: "account-one"
        },
        {
          id: secondId,
          apiKey: "xmlstock-key-two",
          accountIdentifier: "account-two"
        }
      ]
    })
  };
  const connectors = {
    validate: async (
      provider: string,
      secret: Readonly<Record<string, unknown>>,
      timeoutMs: number
    ) => {
      assert.equal(provider, "XMLSTOCK");
      assert.equal(timeoutMs, 8_000);
      assert.deepEqual(secret, {
        apiKey: "xmlstock-key-two",
        accountIdentifier: "account-two",
        rateLimitScopeId: secondId
      });
      return { ok: true, providerMeta: { account: { balance: "1250.50" } } };
    }
  };
  const service = new PlatformAccountProbeService(
    prisma as never,
    crypto as never,
    connectors as never,
    { integrationCredentialValidation: { timeoutMs: 8_000 } } as never
  );

  assert.equal(await service.probeOne(), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.[0], secondId);
  assert.equal(calls[1]?.[2], token);
  assert.equal(calls[1]?.[3], "1250.50");
  assert.equal(calls[1]?.[4], null);
});
