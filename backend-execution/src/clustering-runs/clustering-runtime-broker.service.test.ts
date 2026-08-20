import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  ClusteringRuntimeBrokerService,
  type ClusteringClaim
} from "./clustering-runtime-broker.service.js";

test("binds a clustering item scope as one PostgreSQL UUID array parameter", async () => {
  const leaseExpiresAt = new Date(Date.now() + 90_000).toISOString();
  const itemIds = [
    "01900000-0000-7000-8000-000000000010",
    "01900000-0000-7000-8000-000000000011"
  ];
  let values: readonly unknown[] | undefined;
  const database = {
    $queryRaw: async (query: { readonly values: readonly unknown[] }) => {
      values = query.values;
      return [{
        jobId: "01900000-0000-7000-8000-000000000001",
        jobVersion: 2,
        leaseExpiresAt: new Date(leaseExpiresAt)
      }];
    }
  } as unknown as PrismaService;
  const broker = new ClusteringRuntimeBrokerService(database);
  const claim: ClusteringClaim = {
    jobId: "01900000-0000-7000-8000-000000000001",
    workspaceId: "01900000-0000-7000-8000-000000000002",
    projectId: "01900000-0000-7000-8000-000000000003",
    actorId: "01900000-0000-7000-8000-000000000004",
    credentialId: "01900000-0000-7000-8000-000000000005",
    items: itemIds.map((jobItemId, sequence) => ({
      jobItemId,
      keywordId: `01900000-0000-7000-8000-${String(sequence + 20).padStart(12, "0")}`,
      keywordVersion: 1,
      attempt: 1
    })),
    searchEngine: "YANDEX",
    regionCode: "225",
    method: "HARD",
    overlapCount: 3,
    depth: 10,
    excludeMainPages: false,
    stopDomains: [],
    frequencyTypes: [],
    replaceExistingClusters: false,
    maxAttempts: 720,
    jobVersion: 2,
    leaseOwner: "worker-01",
    leaseExpiresAt,
    encryptedCredential: {
      ciphertext: Buffer.from("ciphertext"),
      nonce: Buffer.from("nonce"),
      authTag: Buffer.from("auth-tag"),
      encryptedDataKey: Buffer.from("encrypted-key"),
      dataKeyNonce: Buffer.from("key-nonce"),
      dataKeyAuthTag: Buffer.from("key-auth-tag"),
      keyVersion: 1
    }
  };

  await broker.renew(claim, 120);

  assert.equal(values?.length, 5);
  assert.deepEqual(values?.[1], itemIds);
});
