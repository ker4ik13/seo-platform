import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import { WorkspaceCredentialRouteProvisioningService } from "./workspace-credential-route-provisioning.service.js";
import { WorkspaceConnectorRoutingService } from "./workspace-connector-routing.service.js";

const databaseUrl = process.env.JOBS_ROUTE_REVOKE_TEST_DATABASE_URL;

test("PostgreSQL atomically revokes a key and removes every route without deleting history", {
  skip: !databaseUrl,
  timeout: 20_000
}, async () => {
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl!, max: 2 })
  });
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const removedId = randomUUID();
  const retainedId = randomUUID();
  try {
    await assert.rejects(
      database.$transaction(async (transaction) => {
        for (const [id, label] of [[removedId, "Removed"], [retainedId, "Retained"]] as const) {
          await transaction.integrationCredential.create({
            data: {
              id,
              workspaceId,
              provider: "XMLSTOCK",
              label,
              mode: "BYOK_API_KEY",
              status: "ACTIVE",
              ciphertext: Buffer.from("encrypted-test-material"),
              nonce: Buffer.alloc(12),
              authTag: Buffer.alloc(16),
              encryptedDataKey: Buffer.from("wrapped-test-key"),
              dataKeyNonce: Buffer.alloc(12),
              dataKeyAuthTag: Buffer.alloc(16),
              keyVersion: 1,
              capabilities: ["SERP_RANK_TRACKING", "WORDSTAT"],
              idempotencyKey: randomUUID(),
              requestFingerprint: Buffer.alloc(32),
              fingerprintKeyVersion: 1,
              createdBy: actorId,
              updatedBy: actorId
            }
          });
        }
        const positions = await transaction.workspaceConnectorBinding.create({
          data: {
            workspaceId,
            capability: "SERP_RANK_TRACKING",
            fallbackMode: "NEXT_AVAILABLE",
            fallbackReasons: ["CREDENTIAL_UNAVAILABLE"],
            createdBy: actorId,
            updatedBy: actorId
          }
        });
        const wordstat = await transaction.workspaceConnectorBinding.create({
          data: {
            workspaceId,
            capability: "WORDSTAT",
            createdBy: actorId,
            updatedBy: actorId
          }
        });
        const primary = await transaction.workspaceConnectorRoute.create({
          data: {
            workspaceId,
            bindingId: positions.id,
            credentialId: removedId,
            position: 0
          }
        });
        await transaction.workspaceConnectorRoute.create({
          data: {
            workspaceId,
            bindingId: positions.id,
            credentialId: retainedId,
            position: 1
          }
        });
        await transaction.workspaceConnectorRoute.create({
          data: {
            workspaceId,
            bindingId: wordstat.id,
            credentialId: removedId,
            position: 0
          }
        });
        const project = await transaction.projectConnectorBinding.create({
          data: {
            workspaceId,
            projectId,
            capability: "SERP_RANK_TRACKING",
            createdBy: actorId,
            updatedBy: actorId
          }
        });
        const historical = await transaction.projectConnectorRoute.create({
          data: {
            workspaceId,
            projectId,
            bindingId: project.id,
            sourceKind: "WORKSPACE_CREDENTIAL",
            credentialId: removedId,
            workspaceRouteId: primary.id,
            position: 0
          }
        });

        const servicePrisma = {
          integrationCredential: transaction.integrationCredential,
          $transaction: async <T>(run: (client: Prisma.TransactionClient) => Promise<T>) =>
            run(transaction as Prisma.TransactionClient)
        } as unknown as PrismaService;
        const provisioning = new WorkspaceCredentialRouteProvisioningService(servicePrisma);
        const service = new IntegrationCredentialService(
          servicePrisma,
          {} as IntegrationCredentialCryptoService,
          undefined,
          provisioning
        );
        await service.revoke(removedId, workspaceId, 1, actorId);
        await assert.rejects(
          new WorkspaceConnectorRoutingService(servicePrisma).upsert({
            workspaceId,
            actorId,
            capability: "SERP_RANK_TRACKING",
            enabled: true,
            routes: [{
              position: 0,
              sourceKind: "WORKSPACE_CREDENTIAL",
              credentialId: removedId
            }],
            fallbackPolicy: { mode: "NONE", reasons: [] }
          }),
          /A selected connection has been disconnected/u
        );

        const positionRoutes = await transaction.workspaceConnectorRoute.findMany({
          where: { workspaceId, bindingId: positions.id },
          orderBy: { position: "asc" }
        });
        assert.deepEqual(positionRoutes.map(({ credentialId, position }) => ({ credentialId, position })), [
          { credentialId: retainedId, position: 0 }
        ]);
        const updatedPositions = await transaction.workspaceConnectorBinding.findUniqueOrThrow({ where: { id: positions.id } });
        const updatedWordstat = await transaction.workspaceConnectorBinding.findUniqueOrThrow({ where: { id: wordstat.id } });
        assert.equal(updatedPositions.fallbackMode, "NONE");
        assert.equal(updatedPositions.version, positions.version + 1);
        assert.equal(updatedWordstat.enabled, false);
        assert.equal(updatedWordstat.version, wordstat.version + 1);
        assert.equal(await transaction.workspaceConnectorRoute.count({ where: { workspaceId, credentialId: removedId } }), 0);
        assert.ok((await transaction.projectConnectorRoute.findUniqueOrThrow({ where: { id: historical.id } })).retiredAt);
        const credential = await transaction.integrationCredential.findUniqueOrThrow({ where: { id: removedId } });
        assert.equal(credential.status, "REVOKED");
        assert.ok(credential.deletedAt);
        assert.equal(credential.version, 2);
        assert.notDeepEqual(Buffer.from(credential.ciphertext), Buffer.from("encrypted-test-material"));
        throw new Error("ROLLBACK_ROUTE_REVOKE_FIXTURE");
      }),
      /ROLLBACK_ROUTE_REVOKE_FIXTURE/u
    );
  } finally {
    await database.$disconnect();
  }
});
