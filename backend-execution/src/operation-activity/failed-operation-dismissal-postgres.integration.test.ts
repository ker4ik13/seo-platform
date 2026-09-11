import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { OperationActivityService } from "./operation-activity.service.js";

const databaseUrl = process.env.JOBS_NOTIFICATION_TEST_DATABASE_URL;

test(
  "PostgreSQL hides only terminal failed operations and retains their Job evidence",
  { skip: databaseUrl === undefined, timeout: 15_000 },
  async () => {
    assert.ok(databaseUrl);
    const prisma = new PrismaService({ databaseUrl } as AppConfig);
    const service = new OperationActivityService(prisma);
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const failed = await prisma.job.create({
      data: {
        workspaceId,
        projectId,
        actorId,
        type: "FREQUENCY_COLLECTION",
        status: "FAILED_FINAL",
        stage: "finished",
        credentialMode: "BYOK_API_KEY",
        provider: "XMLSTOCK",
        idempotencyScope: `dismiss-test:${randomUUID()}`,
        inputSnapshot: {},
        scopeSnapshot: {},
        errorSummary: { code: "TEST_ERROR" },
        progressCurrent: 0n,
        progressTotal: 1n,
        correlationId: `dismiss-test-${randomUUID()}`,
        finishedAt: new Date()
      }
    });
    const completed = await prisma.job.create({
      data: {
        workspaceId,
        projectId,
        actorId,
        type: "FREQUENCY_COLLECTION",
        status: "COMPLETED",
        stage: "finished",
        credentialMode: "BYOK_API_KEY",
        provider: "XMLSTOCK",
        idempotencyScope: `dismiss-test:${randomUUID()}`,
        inputSnapshot: {},
        scopeSnapshot: {},
        progressCurrent: 1n,
        progressTotal: 1n,
        correlationId: `dismiss-test-${randomUUID()}`,
        finishedAt: new Date()
      }
    });

    try {
      const input = {
        workspaceId,
        projectId,
        actorId,
        operationId: failed.id
      };
      const receipt = await service.dismiss(input);
      assert.equal(receipt.operationId, failed.id);
      assert.deepEqual(await service.dismiss(input), receipt);
      const stored = await prisma.job.findUniqueOrThrow({ where: { id: failed.id } });
      assert.equal(stored.dismissedBy, actorId);
      assert.equal(stored.dismissedAt?.toISOString(), receipt.dismissedAt);
      assert.deepEqual(stored.errorSummary, { code: "TEST_ERROR" });

      await assert.rejects(() => service.dismiss({
        ...input,
        operationId: completed.id
      }), /not dismissible/iu);
      await assert.rejects(() => prisma.job.update({
        where: { id: completed.id },
        data: { dismissedAt: new Date(), dismissedBy: actorId }
      }));
    } finally {
      await prisma.job.deleteMany({ where: { id: { in: [failed.id, completed.id] } } });
      await prisma.$disconnect();
    }
  }
);
