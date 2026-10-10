import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../database/prisma.service.js";
import type { AppConfig } from "../config/app-config.js";
import { OperationAnalyticsService } from "./operation-analytics.service.js";
const url = process.env.JOBS_ANALYTICS_TEST_DATABASE_URL;
test(
  "operation analytics captures terminal truth once and excludes technical jobs",
  { skip: !url, timeout: 60_000 },
  async () => {
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.notEqual(parsed.port, "5432");
    const prisma = new PrismaService({
      databaseUrl: url,
      databasePoolMax: 2,
    } as AppConfig);
    try {
      const workspaceId = randomUUID(),
        actorId = randomUUID();
      const input = (type: string) => ({
        workspaceId,
        actorId,
        type,
        status: "QUEUED" as const,
        credentialMode: "BYOK_API_KEY" as const,
        provider: "XMLSTOCK",
        idempotencyScope: randomUUID(),
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        requestHash: randomBytes(32),
        inputSnapshot: { mode: "SEASONALITY" },
        scopeSnapshot: {},
      });
      const job = await prisma.job.create({
        data: input("FREQUENCY_COLLECTION"),
      });
      await prisma.job.create({
        data: input("INTEGRATION_CREDENTIAL_VALIDATE"),
      });
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "RUNNING", startedAt: new Date(), progressCurrent: 1n },
      });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          finishedAt: new Date(),
          progressCurrent: 10n,
          actualCostMicro: 250_000n,
        },
      });
      await prisma.job.update({
        where: { id: job.id },
        data: { progressCurrent: 10n },
      });
      assert.equal(
        await prisma.operationAnalyticsFact.count({ where: { workspaceId } }),
        1,
      );
      const report = await new OperationAnalyticsService(prisma).report(7, []);
      assert.equal(
        report.types.find((row) => row.key === "SEASONALITY_COLLECTION")
          ?.completed,
        1,
      );
      assert.equal(
        report.types.find((row) => row.key === "SEASONALITY_COLLECTION")
          ?.providerCostMicro,
        "250000",
      );
      const excluded = await new OperationAnalyticsService(prisma).report(7, [
        workspaceId,
      ]);
      assert.equal(excluded.types.length, 0);
    } finally {
      await prisma.$disconnect();
    }
  },
);
