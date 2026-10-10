import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { parsePageStatusJobSummary } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { PageStatusService } from "./page-status.service.js";
import { PageStatusWorkerService } from "./page-status-worker.service.js";
const databaseUrl = process.env.JOBS_REMOTE_WORK_TEST_DATABASE_URL;
test("durable page batches resume after a lost response with stable scoped IDs", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl); const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname) && target.port !== "5432");
  const prisma = new PrismaService({ databaseUrl, databasePoolMax: 2 } as never);
  const service = new PageStatusService(prisma), ids = Array.from({ length: 205 }, () => randomUUID()), applied = new Set<string>();
  let lost = true, preparations = 0;
  const scope = { workspaceId: randomUUID(), projectId: randomUUID(), actorId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(), jobCapacity: { planCode: "test", planVersion: 1, concurrentJobs: 2 } };
  const worker = new PageStatusWorkerService(prisma, {
    preparePageStatus: async (input: typeof scope) => { assert.equal(input.workspaceId, scope.workspaceId); preparations++; return ids; },
    applyPageStatus: async (body: { input: { pageIds: string[] } }) => { body.input.pageIds.forEach(id => applied.add(id)); if (lost) { lost = false; throw new Error("Lost committed response"); } return { changed: body.input.pageIds.length, blocked: 0 }; }
  } as never);
  try {
    const created = await service.create(scope, { operation: "archive", pathPrefix: "/ai" });
    assert.deepEqual(parsePageStatusJobSummary(created), created);
    assert.equal((await service.create(scope, { operation: "archive", pathPrefix: "/ai" })).id, created.id);
    await assert.rejects(service.create(scope, { operation: "restore", pathPrefix: "/ai" }));
    await assert.rejects(service.get(randomUUID(), scope.projectId, created.id));
    await worker.tick();
    assert.equal((await service.get(scope.workspaceId, scope.projectId, created.id)).status, "QUEUED");
    await prisma.job.update({ where: { id: created.id }, data: { retryAt: new Date(0) } });
    await worker.tick();
    const result = await service.get(scope.workspaceId, scope.projectId, created.id);
    assert.equal(result.status, "COMPLETED"); assert.equal(result.changed, 205); assert.equal(result.processed, 205); assert.equal(preparations, 1); assert.equal(applied.size, 205);
    const cancelled = await service.create({ ...scope, idempotencyKey: randomUUID() }, { operation: "restore", pageIds: [ids[0]!] });
    await service.cancel(cancelled.id); await worker.tick();
    assert.equal((await service.get(scope.workspaceId, scope.projectId, cancelled.id)).status, "CANCELLED");
  } finally { await worker.onModuleDestroy(); await prisma.job.deleteMany({ where: { workspaceId: scope.workspaceId } }); await prisma.$disconnect(); }
});
