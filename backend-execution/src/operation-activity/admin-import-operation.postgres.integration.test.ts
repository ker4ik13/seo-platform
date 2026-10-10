import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../database/prisma.service.js";
import type { AppConfig } from "../config/app-config.js";
import type { RankOperationProvenanceService } from "../rank-runs/rank-operation-provenance.service.js";
import { OperationActivityService } from "./operation-activity.service.js";

const databaseUrl = process.env.JOBS_ADMIN_OPERATIONS_TEST_DATABASE_URL;
test("admin journal merges durable import/Job histories, paginates across both and resolves import workers", { skip: !databaseUrl }, async () => {
  const prisma = new PrismaService({ databaseUrl, databasePoolMax: 2 } as AppConfig);
  try {
    const workspaceId = randomUUID(), projectId = randomUUID(), actorId = randomUUID();
    const service = new OperationActivityService(prisma, { selectedForJobs: async () => new Map() } as unknown as RankOperationProvenanceService);
    const imports = [];
    const createdAt = Date.now() - 100_000;
    for (let index = 0; index < 24; index++) imports.push(await prisma.semanticImport.create({ data: {
      workspaceId, projectId, actorId, uploadId: randomUUID(), sourceFormat: "CSV", requestedEncoding: "UTF8",
      requestedDelimiter: "COMMA", headerMode: "FIRST_ROW", totalBytes: 100n, progressBytes: 100n,
      totalRows: 2n, validRows: 2n, status: index === 0 ? "PARSING" : index === 1 ? "FAILED" : "COMPLETED",
      stage: index === 0 ? "parsing" : "completed", idempotencyKey: randomUUID(),
      resultSummary: { createdKeywords: "2", updatedKeywords: "0", privateText: "must-not-leak" },
      ...(index === 1 ? { failure: { code: "INVALID_SOURCE_FILE", privateText: "must-not-leak" } } : {}),
      createdAt: new Date(createdAt + index * 1000)
    } }));
    const job = await prisma.job.create({ data: { workspaceId, projectId, actorId, type: "TECHNICAL_CRAWL", status: "QUEUED",
      credentialMode: "PLATFORM_INCLUDED", idempotencyScope: randomUUID(), idempotencyKey: randomUUID(),
      correlationId: randomUUID(), requestHash: randomBytes(32), inputSnapshot: {}, scopeSnapshot: {}, createdAt: new Date(createdAt + 14_500) } });
    const first = await service.adminList({ statusGroup: "ALL", limit: 20 });
    const second = await service.adminList({ statusGroup: "ALL", limit: 20, cursor: first.nextCursor! });
    const rows = [...first.data, ...second.data];
    assert.equal(rows.length, 25); assert.equal(new Set(rows.map(row => row.id)).size, 25);
    assert.ok(rows.some(row => row.id === job.id)); assert.equal(second.nextCursor, undefined);
    assert.deepEqual(first.totals, { total: 25, active: 2, completed: 22, attention: 1 });
    assert.equal(first.types.find(row => row.type === "SEMANTIC_IMPORT")?.count, 24);
    const failed = await service.adminList({ statusGroup: "ATTENTION", type: "SEMANTIC_IMPORT", limit: 20 });
    assert.equal(failed.data.length, 1); assert.equal(failed.data[0]?.errorCode, "INVALID_SOURCE_FILE");
    assert.ok(!JSON.stringify(rows).includes("must-not-leak"));
    const completed = await service.adminDetail(imports[2]!.id);
    assert.equal(completed.type, "SEMANTIC_IMPORT"); assert.equal(completed.status, "COMPLETED"); assert.equal(completed.result.succeeded, 2);
    const node = await prisma.executionWorkerNode.create({ data: { name: "Import worker", tokenHash: randomBytes(32),
      enabled: true, capabilities: ["IMPORT"], reportedHttpSlots: 2, reportedCpuSlots: 2,
      reportedCapabilitySlots: { IMPORT: 2 }, lastHeartbeatAt: new Date(), lastProtocolVersion: 1 } });
    await prisma.remoteOperationAssignment.create({ data: { operationId: imports[0]!.id, capability: "IMPORT", workspaceId, projectId, nodeId: node.id } });
    const active = await service.adminDetail(imports[0]!.id);
    assert.equal(active.workers?.[0]?.nodeId, node.id); assert.equal(active.workers?.[0]?.assignedOperations, 1);
    const overview = await service.overview(); assert.equal(overview.active, 2); assert.equal(overview.completed30d, 22);
  } finally { await prisma.$disconnect(); }
});
