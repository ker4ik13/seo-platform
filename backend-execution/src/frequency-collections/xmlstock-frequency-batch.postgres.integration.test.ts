import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../database/prisma.service.js";
import { FrequencyCollectionLeaseLostError, FrequencyCollectionRuntimeBrokerService } from "./frequency-collection-runtime-broker.service.js";

const databaseUrl = process.env.JOBS_FREQUENCY_BATCH_TEST_DATABASE_URL;

test("XMLStock claims 50 phrases once, settles five fenced waves and keeps retry attempts", {
  skip: !databaseUrl, timeout: 30_000
}, async t => {
  const prisma = new PrismaService({ databaseUrl: databaseUrl!, databasePoolMax: 3, processRole: "CONNECTOR" } as never);
  const broker = new FrequencyCollectionRuntimeBrokerService(prisma);
  t.after(() => prisma.$disconnect());
  const workspaceId = randomUUID(), projectId = randomUUID(), actorId = randomUUID();
  const credential = await prisma.integrationCredential.create({ data: {
    workspaceId, provider: "XMLSTOCK", label: "[E2E] frequency batch", mode: "BYOK_API_KEY", status: "ACTIVE",
    verifiedAt: new Date(), ciphertext: randomBytes(32), nonce: randomBytes(12), authTag: randomBytes(16),
    encryptedDataKey: randomBytes(32), dataKeyNonce: randomBytes(12), dataKeyAuthTag: randomBytes(16),
    keyVersion: 1, capabilities: ["WORDSTAT"], idempotencyKey: randomUUID(),
    requestFingerprint: randomBytes(32), fingerprintKeyVersion: 1
  } });
  const binding = await prisma.projectConnectorBinding.create({ data: {
    workspaceId, projectId, capability: "WORDSTAT", createdBy: actorId, updatedBy: actorId
  } });
  const route = await prisma.projectConnectorRoute.create({ data: {
    workspaceId, projectId, bindingId: binding.id, position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL", credentialId: credential.id
  } });
  const job = await prisma.job.create({ data: {
    workspaceId, projectId, actorId, type: "FREQUENCY_COLLECTION", status: "QUEUED", stage: "collecting",
    credentialMode: "BYOK_API_KEY", provider: "XMLSTOCK", idempotencyScope: `fixture:${randomUUID()}`,
    idempotencyKey: randomUUID(), correlationId: randomUUID(), requestHash: randomBytes(32),
    inputSnapshot: { types: ["BASE"], regionCode: "213", device: "DESKTOP" },
    scopeSnapshot: { credentialId: credential.id, routeId: route.id }, progressTotal: 50n
  } });
  await prisma.jobItem.createMany({ data: Array.from({ length: 50 }, (_, sequence) => ({
    workspaceId, projectId, jobId: job.id, sequence, status: "PENDING", inputReference: { keywordId: randomUUID(), version: 1 }
  })) });

  const claim = await broker.claim(`frequency-batch:${randomUUID()}`, 120, 10_000);
  assert.ok(claim);
  assert.equal(claim.jobId, job.id);
  assert.equal(claim.items.length, 50);
  assert.deepEqual(claim.items.map(item => item.attempt), Array(50).fill(1));

  let current = claim;
  for (let offset = 0; offset < 50; offset += 10) {
    const remaining = claim.items.slice(offset);
    current = await broker.renew({ ...current, items: remaining }, 120);
    const wave = remaining.slice(0, 10);
    const outcomes = wave.map((item, index) => offset === 0 && index === 0
      ? { jobItemId: item.jobItemId, status: "CAPACITY" as const, retryAfterSeconds: 1 }
      : offset === 0 && index === 1
        ? { jobItemId: item.jobItemId, status: "FAILED" as const, code: "PROVIDER_UNAVAILABLE", retryable: true, retryAfterSeconds: 5 }
        : { jobItemId: item.jobItemId, status: "COMPLETED" as const });
    const version = await broker.settleXmlStockBatch({ ...current, items: wave }, outcomes, offset === 40);
    current = { ...current, jobVersion: version };
    const saved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(saved.progressCurrent, BigInt(offset + 8));
    assert.equal(saved.status, offset === 40 ? "RETRY_SCHEDULED" : "RUNNING");
  }
  const items = await prisma.jobItem.findMany({ where: { jobId: job.id }, orderBy: { sequence: "asc" } });
  assert.equal(items[0]?.status, "FAILED_RETRYABLE");
  assert.equal(items[0]?.attempt, 0, "provider capacity cannot spend a retry attempt");
  assert.equal(items[1]?.status, "FAILED_RETRYABLE");
  assert.equal(items[1]?.attempt, 1);
  assert.equal(items.filter(item => item.status === "COMPLETED").length, 48);
  await assert.rejects(() => broker.settleXmlStockBatch(
    { ...claim, items: claim.items.slice(0, 10) },
    claim.items.slice(0, 10).map(item => ({ jobItemId: item.jobItemId, status: "COMPLETED" })), true
  ), FrequencyCollectionLeaseLostError);
});
