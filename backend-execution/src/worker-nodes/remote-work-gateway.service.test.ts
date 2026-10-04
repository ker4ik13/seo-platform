import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { remoteProviderRequest } from "./remote-provider-request.js";
import { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import type { WorkerNodeService } from "./worker-node.service.js";

test("one claimed provider batch reads distinct credentials once and decrypts each once", async () => {
  const workspaceId = randomUUID();
  const credentialIds = [randomUUID(), randomUUID()];
  const physicalKeyScopeId = randomUUID();
  const secret = { apiKey: "fixture-secret", accountIdentifier: "fixture-account", rateLimitScopeId: physicalKeyScopeId };
  const request = remoteProviderRequest(
    `https://xmlstock.com/wordstat/json/?user=${secret.accountIdentifier}&key=${secret.apiKey}&query=fixture`,
    { headers: { Accept: "application/json" } }, secret, "WORDSTAT", 10_000, 1_048_576
  );
  const tasks = [credentialIds[0]!, credentialIds[1]!, credentialIds[0]!].map((credentialId) => ({
    id: randomUUID(), workspaceId, projectId: randomUUID(), operationId: randomUUID(),
    capability: "WORDSTAT", command: "PROVIDER_HTTP", resource: "HTTP", payload: request,
    sourceScope: { credentialId, physicalKeyScopeId, provider: "XMLSTOCK" },
    payloadHash: "a".repeat(64), leaseToken: randomUUID(),
    executionDeadline: new Date(Date.now() + 60_000)
  }));
  tasks.push({ ...tasks[0]!, id: randomUUID(), workspaceId: randomUUID(), leaseToken: randomUUID() });
  let batchReads = 0;
  let individualReads = 0;
  let decryptions = 0;
  const failed: string[] = [];
  const prisma = {
    $queryRaw: async () => tasks,
    remoteWorkTask: { updateMany: async ({ where }: { where: { id: string } }) => {
      failed.push(where.id);
      return { count: 1 };
    } },
    integrationCredential: { findMany: async () => {
      batchReads++;
      return credentialIds.map((id) => ({ id, workspaceId, provider: "XMLSTOCK", status: "ACTIVE", deletedAt: null, keyVersion: 1,
        ciphertext: Buffer.alloc(32), nonce: Buffer.alloc(12), authTag: Buffer.alloc(16),
        encryptedDataKey: Buffer.alloc(32), dataKeyNonce: Buffer.alloc(12), dataKeyAuthTag: Buffer.alloc(16) }));
    }, findFirst: async () => { individualReads++; assert.fail("batch materialization must not query one key at a time"); } }
  } as unknown as PrismaService;
  const gateway = new RemoteWorkGatewayService(
    prisma,
    { authorizeCombinedWork: async () => ({ capabilities: ["WORDSTAT"] }) } as unknown as WorkerNodeService,
    { decrypt: () => { decryptions++; return secret; } } as unknown as IntegrationCredentialCryptoService,
    {} as ObjectStoragePort,
    { workerGatewayEnabled: true, integrationCredentials: { activeKeyVersion: 1,
      keys: new Map([[1, Buffer.alloc(32, 9)]]) } } as unknown as AppConfig
  );

  const claimed = await gateway.claim(randomUUID(), "node-token", {
    httpSlots: 3, cpuSlots: 0, capabilitySlots: { WORDSTAT: 3 }
  });
  assert.equal(claimed.length, 3);
  assert.equal(batchReads, 1);
  assert.equal(individualReads, 0);
  assert.equal(decryptions, 2);
  assert.deepEqual(failed, [tasks[3]!.id], "another workspace cannot reuse a cached credential");
  assert.ok(claimed.every((task) => String(task.payload.url).includes(secret.apiKey)));
});
