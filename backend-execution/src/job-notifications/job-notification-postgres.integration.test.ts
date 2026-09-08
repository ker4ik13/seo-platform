import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { JobNotificationClient } from "../platform-api/job-notification.client.js";
import { JobNotificationDispatcherService } from "./job-notification-dispatcher.service.js";

const databaseUrl = process.env.JOBS_NOTIFICATION_TEST_DATABASE_URL;

test("PostgreSQL drains more than one terminal batch, handles races and never requeues a sent state", {
  skip: !databaseUrl,
  timeout: 30_000
}, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432",
    "Notification integration test requires a disposable local PostgreSQL cluster on a separate port");
  const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) });
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const service = new JobNotificationDispatcherService(database as PrismaService, {} as JobNotificationClient);
  const replica = new JobNotificationDispatcherService(database as PrismaService, {} as JobNotificationClient);
  try {
    assert.equal(await database.job.count(), 0, "Use a fresh jobs_db for this regression");
    await database.job.createMany({ data: Array.from({ length: 457 }, (_, index) => ({
      workspaceId, projectId, actorId, type: "AUDIT_NOTIFICATION", status: "COMPLETED" as const,
      idempotencyScope: `notification-audit:${workspaceId}:${index}`,
      inputSnapshot: {}, scopeSnapshot: {}, credentialMode: "BYOK_API_KEY" as const,
      correlationId: `audit-${index}`, progressCurrent: 1n, progressTotal: 1n,
      finishedAt: new Date(), updatedAt: new Date(Date.now() - (500 - index) * 1_000)
    })) });
    // Two replicas can read the same batch; the unique index must arbitrate
    // without PostgreSQL unique violations or duplicate notification rows.
    const concurrent = await Promise.all([service.enqueueTerminalJobs(200), replica.enqueueTerminalJobs(200)]);
    assert.ok(concurrent.reduce((sum, count) => sum + count, 0) >= 200);
    while (await service.enqueueTerminalJobs(200)) { /* drain the backlog */ }
    assert.equal(await database.outboxEvent.count({ where: { workspaceId } }), 457);
    await database.outboxEvent.updateMany({ where: { workspaceId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    assert.equal(await service.enqueueTerminalJobs(), 0);
    assert.equal(await replica.enqueueTerminalJobs(), 0);
    const job = await database.job.findFirstOrThrow({ where: { workspaceId } });
    await database.job.update({ where: { id: job.id }, data: { status: "ACTION_REQUIRED" } });
    assert.equal(await service.enqueueTerminalJobs(), 1);
    assert.equal(await service.enqueueTerminalJobs(), 0);
    assert.equal(await database.outboxEvent.count({ where: { workspaceId, aggregateId: job.id } }), 2);
    const event = await database.outboxEvent.findFirstOrThrow({ where: { workspaceId } });
    assert.equal(JSON.stringify(event.payload).includes("inputSnapshot"), false);
  } finally {
    await database.outboxEvent.deleteMany({ where: { workspaceId } });
    await database.job.deleteMany({ where: { workspaceId } });
    await database.$disconnect();
  }
});
